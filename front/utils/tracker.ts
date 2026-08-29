/**
 * 前端埋点 SDK（契约见 docs/埋点打点方案.md，后端接口 docs/API.md「七、用户行为打点」）。
 *
 * 设计要点：
 * - **统一入口 `trackEvent(key, params)`**：事件定义集中声明在 config/tracking.ts 的
 *   TRACK_EVENT_DEFS（事件名 / eventType / page / target / props 映射），调用方只传业务参数，
 *   新增事件只需在定义表加一行，无需新写辅助函数；
 * - 内存队列 + 攒批（batchSize 条或 flushIntervalMs 定时）上报 POST /api/v1/track/events；
 * - eventId = `sessionId-序号`，服务端幂等去重；上报失败放回队首重试（队列超 maxQueue 丢最旧）；
 * - **打点只在登录成功后才上报**：flush 前先 await 登录门闩（setTrackingLoginWaiter 注入），
 *   登录成功才发请求（带 Bearer 让后端解析 user_id）；登录失败时事件留在队列，等下次 flush 重试；
 * - 页面 PV 用 wx.onAppRoute 全局一处采集（page.view / page.hide + durationMs，免改各页），
 *   个股 / 板块 / 分时 / 新闻列表等从路由 query 提取 code 作 target；
 * - 合规：绝不上报 openid / 手机号 / 昵称；props / target 统一截断、剔除 undefined。
 */
import { TRACK_EVENT_DEFS, TRACKING_CONFIG, clip } from '../config/tracking'
import { TrackEventType } from '../types/tracking'
import type {
  AppRouteEvent,
  TrackBatchResult,
  TrackEvent,
  TrackEventParams,
} from '../types/tracking'
import { request } from './request'
import { getAppVersion } from './version'

/** 自动采集的页面事件（不对外调用，仅内部生命周期使用） */
const PAGE_VIEW = 'page.view'
const PAGE_HIDE = 'page.hide'

/** 会话 id：小程序一次启动一个（eventId 前缀 + 批量归组） */
const sessionId = `${Date.now()}-${Math.random().toString(36).slice(2)}`
let seq = 0
let queue: TrackEvent[] = []
let flushing = false
let enabled: boolean = TRACKING_CONFIG.enabled
let initialized = false
let flushTimer: ReturnType<typeof setInterval> | null = null

/**
 * 登录门闩：打点必须在登录成功后才上报（app.ts 注入 rootStore.auth.ensureLogin）。
 * 返回是否登录成功：false 时不发请求，事件留在队列等下次 flush。
 */
type LoginWaiter = () => Promise<boolean>
let loginWaiter: LoginWaiter | null = null

/** 当前页面停留（page.view 进入、page.hide 离开时结算 durationMs） */
let currentPage = ''
let pageEnterAt = 0

/** 当前页面路由（getCurrentPages 栈顶，取不到时返回空串） */
function currentPagePath(): string {
  try {
    const pages = getCurrentPages()
    const current = pages[pages.length - 1]
    return current ? current.route || '' : ''
  } catch {
    return ''
  }
}

/** 运行时平台：devtools / ios / android / windows / mac */
function getPlatform(): string {
  try {
    if (typeof wx.getDeviceInfo === 'function') {
      return wx.getDeviceInfo().platform || 'devtools'
    }
    return wx.getSystemInfoSync().platform || 'devtools'
  } catch {
    return 'devtools'
  }
}

const platform = getPlatform()
const appVersion = getAppVersion()

/** 清洗 props：递归剔除 undefined / 函数，字符串截断到 maxStringLen；空对象归一为 undefined */
function sanitizeProps(
  props: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!props) return undefined
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || typeof value === 'function') continue
    if (typeof value === 'string') {
      result[key] = clip(value, TRACKING_CONFIG.maxStringLen)
    } else if (Array.isArray(value)) {
      result[key] = value
        .filter((item) => item !== undefined && typeof item !== 'function')
        .map((item) => (typeof item === 'string' ? clip(item, TRACKING_CONFIG.maxStringLen) : item))
    } else if (value !== null && typeof value === 'object') {
      result[key] = sanitizeProps(value as Record<string, unknown>)
    } else {
      result[key] = value
    }
  }
  return Object.keys(result).length > 0 ? result : undefined
}

export interface TrackExtra {
  eventType?: TrackEventType
  /** 触发页路由，缺省取当前页面 */
  page?: string
  target?: string
  props?: Record<string, unknown>
  durationMs?: number
}

/**
 * 记录一条事件（底层原语）：入内存队列，达到攒批阈值立即上报。
 * 业务侧请优先用 trackEvent(key, params)（定义表声明式组装）；本函数供页面生命周期
 * （page.view / page.hide）与个别需要完全自定义的事件使用。
 * 事件丢失可接受（定时 flush + onHide flush，最多丢最近几秒），因此同步返回、不阻塞业务。
 */
export function track(eventName: string, extra: TrackExtra = {}): void {
  if (!enabled) return
  const event: TrackEvent = {
    eventId: `${sessionId}-${++seq}`,
    eventName,
    eventType: extra.eventType,
    page: extra.page || currentPagePath(),
    target: extra.target ? clip(extra.target, TRACKING_CONFIG.maxStringLen) : undefined,
    props: sanitizeProps(extra.props),
    durationMs: extra.durationMs,
    sessionId,
    clientTs: Date.now(),
    platform,
    appVersion,
  }
  queue.push(event)
  if (queue.length >= TRACKING_CONFIG.batchSize) void flush()
}

/**
 * 统一打点入口：key 为 TRACK_EVENT_DEFS 的键名，params 为业务参数（尽量少传）：
 * - 标量（string/number/boolean）：定义表声明了 target 时作 target；否则作唯一 props 字段的值；
 * - 对象：按定义表 target / props 声明的字段名取值；
 * - 不传：用于无需业务参数的事件（share.trigger / login.action）。
 * 事件名 / eventType / page / props 组装规则全部来自定义表；未登记的事件不产生数据（warn 提示）。
 */
export function trackEvent(key: string, params: TrackEventParams = undefined): void {
  const def = TRACK_EVENT_DEFS[key]
  if (!def) {
    console.warn(
      `[tracker] 未登记的打点事件: ${key}，请在 config/tracking.ts 的 TRACK_EVENT_DEFS 中登记`,
    )
    return
  }
  // 标量参数归一：target 优先，否则作为唯一 props 字段的值
  let normalized = params
  let targetValue: unknown
  if (typeof params === 'string' || typeof params === 'number' || typeof params === 'boolean') {
    if (def.target) {
      targetValue = params
      normalized = {}
    } else {
      const fields = def.props ? Object.keys(def.props) : []
      normalized = fields.length === 1 ? { [fields[0]!]: params } : {}
    }
  }
  const p = (normalized ?? {}) as Record<string, unknown>

  // 必填校验：缺失 / trim 后为空不上报
  for (const field of def.required ?? []) {
    const raw = p[field]
    if (raw === undefined || raw === null || String(raw).trim() === '') return
  }

  const ctx = { page: def.page || currentPagePath(), params: p }

  // target：缺省按定义表字段取，标量已在上方处理
  let target: string | undefined
  if (def.target) {
    const raw = targetValue !== undefined ? targetValue : p[def.target]
    if (raw !== undefined && raw !== null && String(raw).trim() !== '') {
      target = String(raw)
    }
  }

  // props：按定义表映射（字符串=参数字段名透传；函数=上下文转换 / 兜底），空值剔除
  const props: Record<string, unknown> = {}
  if (def.props) {
    for (const [outKey, mapper] of Object.entries(def.props)) {
      const value = typeof mapper === 'function' ? mapper(ctx) : p[mapper]
      if (value !== undefined && value !== null && value !== '') props[outKey] = value
    }
  }

  track(def.name, {
    eventType: def.type,
    page: ctx.page,
    target,
    props: Object.keys(props).length > 0 ? props : undefined,
  })
}

/**
 * 立即上报队列内全部事件（成功清空；失败放回队首重试，队列超 maxQueue 丢最旧）。
 * **只在登录成功后上报**：flush 前先 await 登录门闩，登录未成功（含失败）时事件留在队列，
 * 等定时器 / onHide / 下一次 flush 再试，绝不匿名上报。
 * 上报走独立异步请求，不阻塞业务；重复上报由服务端按 eventId 幂等去重。
 */
export async function flush(): Promise<void> {
  if (!enabled || flushing || queue.length === 0) return
  if (loginWaiter) {
    const ok = await loginWaiter()
    // await 期间可能有其他 flush 已上报 / 队列被清空，重新校验
    if (!ok || flushing || queue.length === 0) return
  }
  flushing = true
  const events = queue.splice(0, queue.length)
  return request<TrackBatchResult>({
    path: TRACKING_CONFIG.apiPath,
    method: 'POST',
    data: { events },
    // 打点已在上面保证登录成功，这里跳过通用登录门闩（避免二次等待）；withAuth 带 Bearer 解析 user_id
    withAuth: true,
    skipLoginWait: true,
  })
    .then(() => undefined)
    .catch(() => {
      // 失败放回队首（保持事件时序），eventId 幂等兜底；堆积超上限丢最旧
      queue.unshift(...events)
      if (queue.length > TRACKING_CONFIG.maxQueue) {
        queue.splice(0, queue.length - TRACKING_CONFIG.maxQueue)
      }
    })
    .finally(() => {
      flushing = false
    })
}

/**
 * 注入登录门闩（app.ts 调用，与 utils/request.ts 的 setLoginWaiter 同模式）：
 * 打点上报前必须等该 Promise 返回 true（登录成功），false 时不上报、事件留队。
 */
export function setTrackingLoginWaiter(waiter: LoginWaiter | null): void {
  loginWaiter = waiter
}

/** 结束当前页面停留：补发 page.hide + durationMs（路由切换 / App 退后台时调用） */
function endPageStay(): void {
  if (!currentPage) return
  const durationMs = Math.max(0, Date.now() - pageEnterAt)
  track(PAGE_HIDE, { page: currentPage, eventType: TrackEventType.PageHide, durationMs })
  currentPage = ''
  pageEnterAt = 0
}

/** 从路由 query 提取「主对象」作 target（个股 / 板块 / 分时 / 个股新闻列表的 code） */
function targetFromQuery(path: string, query?: Record<string, string>): string {
  const code = query?.code
  if (typeof code !== 'string' || !code) return ''
  // 精确匹配目标页：news-detail 的 query 是 title/url/id，无 code，不在此列
  const isTargetedPage =
    path.startsWith('packageQuote/pages/stock-detail') ||
    path.startsWith('packageQuote/pages/sector-detail') ||
    path.startsWith('packageQuote/pages/minute') ||
    path === 'packageNews/pages/news/index'
  return isTargetedPage ? clip(code, TRACKING_CONFIG.maxStringLen) : ''
}

/** 进入页面：结算上一页停留 → 记录 page.view */
function enterPage(path: string, query?: Record<string, string>): void {
  if (!path) return
  endPageStay()
  currentPage = path
  pageEnterAt = Date.now()
  track(PAGE_VIEW, {
    page: path,
    eventType: TrackEventType.PageView,
    target: targetFromQuery(path, query),
  })
}

/**
 * 路由变化回调（wx.onAppRoute，基础库 2.4.4+，覆盖 navigateTo / switchTab / reLaunch / redirectTo）。
 * 冷启动时若首个 page.view 已由 App.onShow 兜底登记，同一路径跳过，避免重复 view/hide。
 */
function onAppRoute(res: AppRouteEvent): void {
  if (res.path === currentPage) return
  enterPage(res.path, res.query)
}

/** 初始化：注册全局路由监听（幂等，App.onLaunch 调用一次） */
export function initTracker(): void {
  if (initialized) return
  initialized = true
  if (typeof wx.onAppRoute === 'function') {
    wx.onAppRoute((res) => onAppRoute(res))
  }
}

/**
 * App.onShow 调用：
 * - 冷启动：wx.onAppRoute 对首帧路由的触发时机不保证在 App.onShow 之前，这里兜底补发首个 page.view；
 * - 后台返回：上一页停留已在 onAppHide 结算（page.hide），这里重新开始停留并补发 page.view
 *   （每次进入前台 = 一次新访问，view/hide 始终保持成对）。
 */
export function onAppShow(): void {
  if (currentPage) return
  const path = currentPagePath()
  if (!path) return
  currentPage = path
  pageEnterAt = Date.now()
  track(PAGE_VIEW, { page: path, eventType: TrackEventType.PageView })
}

/** App.onHide 调用：结算当前页停留（page.hide + durationMs）并尽量在退后台前上报 */
export function onAppHide(): void {
  endPageStay()
  void flush()
}

/** 启动定时上报（App.onLaunch 调用；测试环境不调用，避免挂起事件循环） */
export function startFlushTimer(): void {
  if (flushTimer) return
  flushTimer = setInterval(() => {
    void flush()
  }, TRACKING_CONFIG.flushIntervalMs)
}

/** 运行时开关（调试 / 灰度用） */
export function setTrackingEnabled(value: boolean): void {
  enabled = value
}

/** 测试辅助：清空内部状态（队列 / 序号 / 页面停留 / 定时器 / 初始化标记 / 登录门闩） */
export function __resetTrackerForTest(): void {
  if (flushTimer) {
    clearInterval(flushTimer)
    flushTimer = null
  }
  queue = []
  flushing = false
  seq = 0
  currentPage = ''
  pageEnterAt = 0
  initialized = false
  enabled = TRACKING_CONFIG.enabled
  loginWaiter = null
}
