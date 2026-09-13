import { INTERSTITIAL_AD_CONFIG, type InterstitialLocation } from '../config/interstitial-ad'
import { rootStore } from '../stores/root.store'
import { todayDateString } from './popup-notice'
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
 * - 页面接入只需一行：`maybeShowInterstitial('global')`（放在页面 onShow，见各接入页）；
 * - 展示时序参考 firm/ad-component 的 gdt 插屏：createInterstitialAd → onLoad → show()
 *   （成功才计入「今日次数」与「上次展示时间」）→ onClose 销毁实例并释放锁；onError /
 *   show 失败按 maxAttempts 轻量重试；创建后超 loadTimeoutMs 未就绪由看门狗销毁释放，
 *   避免锁卡死后续触发；App 退后台（wx.onAppHide）销毁在途实例，防止回前台残留。
 *
 * 触发闸门（顺序判定，任一不过即放弃，全部静默降级不影响页面）：
 *   enabled → location 有 unit-id → 微信版本支持 createInterstitialAd → 全局空闲 →
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
/** wx.onAppHide 是否已注册（惰性注册一次） */
let appHideBound = false

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

  const interstitialAd = wx.createInterstitialAd({ adUnitId: unitId })
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

/** 惰性注册 App 退后台监听：销毁在途实例并释放锁（只注册一次） */
function bindAppHide() {
  if (appHideBound || typeof wx === 'undefined' || typeof wx.onAppHide !== 'function') return
  appHideBound = true
  wx.onAppHide(() => {
    if (state !== 'idle') teardown('App 退后台')
  })
}

/** 解析 location 对应的 unit-id：位置级覆盖 > 全局默认；未配置返回空串 */
export function resolveUnitId(location: InterstitialLocation): string {
  const cfg = INTERSTITIAL_AD_CONFIG
  return cfg.unitIdByLocation[location] ?? cfg.unitId ?? ''
}

/**
 * 插屏广告统一触发入口（页面 onShow 调用，见各接入页）：
 * 所有闸门 + 全局单飞 + 展示流程都在这里收口，调用方无需关心并发与频控。
 */
export function maybeShowInterstitial(location: InterstitialLocation): void {
  const cfg = INTERSTITIAL_AD_CONFIG

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
  bindAppHide()
  startAttempt(location, unitId)
}
