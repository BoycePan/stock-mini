import { INTERSTITIAL_AD_CONFIG, type InterstitialLocation } from '../config/interstitial-ad'
import { rootStore } from '../stores/root.store'
import { todayDateString } from './popup-notice'
import { markAppForeground, resolvePageShowReason } from './page-show'
import {
  consumeDailyShow,
  readDailyState,
  readLastShowAt,
  todayShownCount,
  userDailyCap,
  writeDailyState,
  writeLastShowAt,
} from './interstitial-frequency'

/**
 * 插屏广告全局调度（纯脚本，无 wxml / 组件——插屏是原生全屏广告不需要 UI）。
 *
 * 设计（需求口径，参数配置集中在 config/interstitial-ad.ts）：
 * - **全局单飞**：module 级状态机 idle / loading / showing，同一时刻只允许一个
 *   「创建 → 加载 → 展示」流程在跑；其他页面 / 其他 tab 的 onShow 触发一律丢弃并打日志，
 *   从根上保证「全局同时只能进行一个插屏加载」——tab 页 keep-alive 下 onShow 高频并发
 *   触发（切 tab / 从详情返回 / App 回前台）全部收敛到这里；
 * - 页面接入只需一行：`maybeShowInterstitial('global', this)`（放在页面 onShow，见各接入页）；
 * - **触发时机**（闸门 0，判定见 utils/page-show.ts）：只有「onLoad 后首次显示 / 用户切 tab /
 *   App 回前台」展示，**从子页面返回（navigateBack）不展示**——后者是高频动作，
 *   每次返回都弹全屏广告会严重干扰浏览；
 * - 展示时序参考 firm/ad-component 的 gdt 插屏：createInterstitialAd → onLoad → show()
 *   （成功才计入「今日次数」与「上次展示时间」）→ onClose 销毁实例并释放锁；onError /
 *   show 失败按 maxAttempts 轻量重试；创建后超 loadTimeoutMs 未就绪由看门狗销毁释放，
 *   避免锁卡死后续触发；App 退后台（wx.onAppHide）销毁在途实例，防止回前台残留。
 * - **异常不外泄、不占锁**：创建实例同步抛错 / 返回非法实例同样按「本次尝试失败」收敛
 *   （重试或收尾），不会把 state 停在 loading 卡死全局锁；展示成功（state='showing'）
 *   之后迟到的失败回调不再重试——否则会销毁正在展示的插屏并重复计数，等待 onClose 收尾。
 *
 * 触发闸门（顺序判定，任一不过即放弃，全部静默降级不影响页面）：
 *   显示原因非「从子页面返回」→ enabled → location 有 unit-id →
 *   微信版本支持 createInterstitialAd → 全局空闲 →
 *   今日已展示次数 < 个人每日上限（新用户 1 / 老用户 3，按 created_at 分级）→
 *   距上次展示 ≥ minIntervalMs(15s，跨启动生效) → 才真正创建展示。
 */

type AdRunState = 'idle' | 'loading' | 'showing'

/** 当前广告流程状态（全局单飞锁） */
let state: AdRunState = 'idle'
/** 当前插屏实例（loading 中可能已创建） */
let adInstance: WechatMiniprogram.InterstitialAd | null = null
/** 尝试序号：每次开始新尝试 +1，旧尝试的异步回调据此丢弃，防止销毁后残留回调误改状态 */
let attemptSeq = 0
/** 当前这次完整流程已尝试的次数（含首次；只在闸门通过后重置，跨多次重试累计） */
let runAttempts = 0
/** 失败重试定时器 */
let retryTimer: ReturnType<typeof setTimeout> | null = null
/** 加载看门狗定时器 */
let watchdog: ReturnType<typeof setTimeout> | null = null
/** 本次流程是否已展示成功（保证一次流程只计一次数） */
let shownInRun = false
/** wx.onAppShow / wx.onAppHide 是否已注册（惰性注册一次） */
let appLifecycleBound = false

function clearTimers() {
  if (retryTimer !== null) {
    clearTimeout(retryTimer)
    retryTimer = null
  }
  if (watchdog !== null) {
    clearTimeout(watchdog)
    watchdog = null
  }
}

/** 销毁当前插屏实例并置空（不改变 state，由调用方决定后续） */
function destroyInstance() {
  if (adInstance) {
    try {
      adInstance.destroy()
    } catch {
      // 实例已失效时 destroy 可能抛错，忽略即可
    }
    adInstance = null
  }
}

/**
 * 创建插屏实例：创建过程同步抛错（如 adUnitId 非法）或返回缺少事件挂载方法的非法实例时，
 * 一律返回 null 交由调用方按「本次尝试失败」收敛（重试 / 达上限收尾）。
 * **绝不能让异常抛出**：startAttempt 已把 state 置为 loading，异常冒泡到页面 onShow 后
 * 没有任何路径再改回 idle，本次会话所有后续触发都会被闸门 2（全局单飞）拦死。
 */
function createInstance(unitId: string): WechatMiniprogram.InterstitialAd | null {
  try {
    const ad = wx.createInterstitialAd({ adUnitId: unitId }) as
      WechatMiniprogram.InterstitialAd | null | undefined
    if (
      !ad ||
      typeof ad.onLoad !== 'function' ||
      typeof ad.onError !== 'function' ||
      typeof ad.onClose !== 'function' ||
      typeof ad.show !== 'function'
    ) {
      console.error('[interstitial] createInterstitialAd 返回非法实例，放弃本次尝试')
      return null
    }
    return ad
  } catch (error) {
    console.error('[interstitial] 创建插屏实例失败', error)
    return null
  }
}

/** 完全收尾：清定时器、销毁实例、释放全局单飞锁 */
function teardown(reason: string) {
  console.warn(`[interstitial] 结束广告流程: ${reason}`)
  clearTimers()
  destroyInstance()
  state = 'idle'
}

/** 记录「展示成功」：计入今日次数 + 记录上次展示时间（跨启动生效） */
function recordShown() {
  const today = todayDateString()
  writeDailyState(consumeDailyShow(today, readDailyState()))
  writeLastShowAt(Date.now())
}

/** 看门狗：创建后超时仍未展示成功则销毁释放（防止 onLoad 永不到达卡死全局锁） */
function armWatchdog(token: number) {
  clearWatchdog()
  watchdog = setTimeout(() => {
    watchdog = null
    if (token === attemptSeq && state === 'loading') {
      teardown('加载看门狗超时')
    }
  }, INTERSTITIAL_AD_CONFIG.loadTimeoutMs)
}

function clearWatchdog() {
  if (watchdog !== null) {
    clearTimeout(watchdog)
    watchdog = null
  }
}

/** 一次失败后的处理：未达尝试上限则延时重试同一 location/unitId，否则收尾释放锁 */
function handleFail(token: number, location: InterstitialLocation, unitId: string) {
  if (token !== attemptSeq) return
  // 展示成功后到达的失败回调（onError / show 异常）：不再重试。
  // 重试会 destroy 掉正在展示的插屏，并因 startAttempt 重置 shownInRun 而把同一次流程
  // 重复计入「今日次数」，破坏「一次流程只计一次」；此处保持锁，交给 onClose
  // （或 App 退后台）收尾，避免对正在展示的广告再发一次 show。
  if (shownInRun || state === 'showing') {
    console.warn('[interstitial] 插屏已展示成功，忽略迟到的失败回调（不重试，等待 onClose 收尾）')
    return
  }
  const { maxAttempts, retryIntervalMs } = INTERSTITIAL_AD_CONFIG
  if (runAttempts < maxAttempts) {
    clearTimers()
    retryTimer = setTimeout(() => {
      retryTimer = null
      startAttempt(location, unitId)
    }, retryIntervalMs)
    return
  }
  teardown(`重试达上限（共尝试 ${runAttempts} 次）`)
}

/** 开始一次尝试（首次触发与失败重试共用；每次 +1 尝试序号使旧回调失效） */
function startAttempt(location: InterstitialLocation, unitId: string) {
  attemptSeq += 1
  const token = attemptSeq
  runAttempts += 1
  shownInRun = false
  state = 'loading'
  clearTimers()

  // 替换实例前先销毁旧实例，避免同一广告位并发持有多个实例
  destroyInstance()

  if (typeof wx === 'undefined' || typeof wx.createInterstitialAd !== 'function') {
    teardown('wx.createInterstitialAd 不可用')
    return
  }

  const interstitialAd = createInstance(unitId)
  if (!interstitialAd) {
    // 创建失败与 onError / show 失败同路径收敛：未达上限则重试，达上限收尾释放锁，
    // 保证任何异常都不会把 state 留在 loading（见 createInstance 注释）
    handleFail(token, location, unitId)
    return
  }
  adInstance = interstitialAd

  interstitialAd.onLoad(() => {
    if (token !== attemptSeq) return
    interstitialAd
      .show()
      .then(() => {
        if (token !== attemptSeq) return
        // 展示成功：计数（一次流程只计一次）并进入「展示中」直至 onClose
        if (!shownInRun) {
          shownInRun = true
          recordShown()
        }
        state = 'showing'
      })
      .catch((error: unknown) => {
        console.error('[interstitial] 插屏展示失败', error)
        handleFail(token, location, unitId)
      })
  })

  interstitialAd.onError((error) => {
    console.error('[interstitial] 插屏加载失败', error)
    handleFail(token, location, unitId)
  })

  interstitialAd.onClose(() => {
    if (token !== attemptSeq) return
    teardown('用户关闭插屏')
  })

  armWatchdog(token)
}

/**
 * 惰性注册 App 前后台监听（只注册一次）：
 * - 退后台：销毁在途实例并释放锁；
 * - 回前台：打标（`markAppForeground`），供闸门 0 把「回到前台」与「从子页面返回」区分开。
 */
function bindAppLifecycle() {
  if (appLifecycleBound || typeof wx === 'undefined') return
  appLifecycleBound = true
  if (typeof wx.onAppHide === 'function') {
    wx.onAppHide(() => {
      if (state !== 'idle') teardown('App 退后台')
    })
  }
  if (typeof wx.onAppShow === 'function') {
    wx.onAppShow(() => markAppForeground())
  }
}

/** 解析 location 对应的 unit-id：位置级覆盖 > 全局默认；未配置返回空串 */
export function resolveUnitId(location: InterstitialLocation): string {
  const cfg = INTERSTITIAL_AD_CONFIG
  return cfg.unitIdByLocation[location] ?? cfg.unitId ?? ''
}

/**
 * 插屏广告统一触发入口（页面 onShow 调用，见各接入页）：
 * 所有闸门 + 全局单飞 + 展示流程都在这里收口，调用方无需关心并发与频控。
 *
 * @param location 触发位置（见 config/interstitial-ad.ts）
 * @param page 页面实例（调用处传 `this`）：用于判定这是该页面的第几次显示
 */
export function maybeShowInterstitial(location: InterstitialLocation, page: object): void {
  const cfg = INTERSTITIAL_AD_CONFIG

  // 闸门 0：本次「页面显示」的来源——从子页面返回（navigateBack）触发的 onShow 一律不展示：
  // 返回是最高频的动作（每次看完详情都要返回），此时弹全屏广告会打断浏览；
  // 首次进入 / 用户切 tab / App 回前台仍可展示（判定见 utils/page-show.ts）
  const reason = resolvePageShowReason(location, page)
  if (reason === 'return') {
    console.warn('[interstitial] 从子页面返回触发的 onShow，跳过')
    return
  }
  if (reason === 'app-foreground' && !cfg.showOnAppForeground) {
    console.warn('[interstitial] App 回前台触发的 onShow，配置为不展示，跳过')
    return
  }

  // 闸门 1：总开关
  if (!cfg.enabled) {
    console.warn('[interstitial] 总开关关闭，跳过')
    return
  }
  // 闸门 2：全局单飞——同一时刻只有一个插屏加载/展示
  if (state !== 'idle') {
    console.warn(`[interstitial] 已有插屏在加载/展示（state=${state}），丢弃本次触发`)
    return
  }
  // 闸门 3：广告位配置
  const unitId = resolveUnitId(location)
  if (!unitId) {
    console.warn(
      `[interstitial] location=${location} 未配置 unit-id（config/interstitial-ad.ts），跳过`,
    )
    return
  }
  // 闸门 4：微信版本支持
  if (
    typeof wx === 'undefined' ||
    typeof wx.canIUse !== 'function' ||
    !wx.canIUse('createInterstitialAd')
  ) {
    console.warn('[interstitial] 当前微信版本不支持插屏广告，跳过')
    return
  }
  // 闸门 5：当日次数上限（新用户 1 / 老用户 3，按 user.created_at 分级）
  const now = new Date()
  const cap = userDailyCap({
    userCreatedAt: rootStore.auth.user?.created_at,
    now,
    newUserWindowDays: cfg.newUserWindowDays,
    newUserDailyCap: cfg.newUserDailyCap,
    regularDailyCap: cfg.dailyCap,
  })
  const shown = todayShownCount(todayDateString(now), readDailyState())
  if (shown >= cap) {
    console.warn(
      `[interstitial] 今日已展示 ${shown} 次 ≥ 上限 ${cap}（${cap <= cfg.newUserDailyCap ? '新用户' : '老用户'}），跳过`,
    )
    return
  }
  // 闸门 6：两次展示最小间隔（15s，跨启动生效）
  const elapsed = Date.now() - readLastShowAt()
  if (elapsed < cfg.minIntervalMs) {
    console.warn(`[interstitial] 距上次展示 ${elapsed}ms < ${cfg.minIntervalMs}ms，跳过`)
    return
  }

  runAttempts = 0
  bindAppLifecycle()
  startAttempt(location, unitId)
}
