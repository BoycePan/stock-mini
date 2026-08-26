/**
 * 用户行为打点（前端埋点）类型定义。
 * 契约见 docs/埋点打点方案.md 与 docs/API.md「七、用户行为打点」（POST /api/v1/track/events）。
 */

/**
 * 事件大类（对应后端 click_event.event_type）。
 * 枚举语义：成员值即上报字符串，类型与值同名（值空间 + 类型空间合并）。
 * 用 const 对象 + as const（而非 TS enum 关键字）：测试运行器走 Node
 * `--experimental-strip-types`，只剥类型不支持 enum 语法，该写法等价且全兼容。
 */
export enum TrackEventType {
  /** 进入页面（自动 page.view） */
  PageView = 'page_view',
  /** 离开页面（自动 page.hide） */
  PageHide = 'page_hide',
  /** 点击 */
  Tap = 'tap',
  /** 主动动作（分享 / 搜索 / 切 Tab / 切主题 / 登录等） */
  Action = 'action',
}

/** 单条打点事件（POST /api/v1/track/events 的 events 元素） */
export interface TrackEvent {
  /** 客户端幂等键（sessionId + 自增序号），服务端按 event_id 去重 */
  eventId: string
  /** 点分事件名，如 search.submit */
  eventName: string
  eventType?: TrackEventType
  /** 触发页路由，如 pages/search/index */
  page: string
  /** 目标：跳转页 / 标的 code / Tab 名 */
  target?: string
  /** 扩展属性（任意 JSON 对象；已剔除 undefined，字符串截断到配置上限） */
  props?: Record<string, unknown>
  /** 页面停留时长（毫秒，page.hide 携带） */
  durationMs?: number
  /** 会话 id（小程序一次启动一个） */
  sessionId: string
  /** 客户端事件时间戳（毫秒） */
  clientTs: number
  /** devtools / ios / android / windows / mac */
  platform: string
  /** 小程序版本号 */
  appVersion: string
}

/** 批量上报请求体 */
export interface TrackBatchPayload {
  events: TrackEvent[]
}

/** 批量上报响应 data（后端回执） */
export interface TrackBatchResult {
  accepted: number
  duplicated: number
  invalid: number
}

/**
 * wx.onAppRoute 监听回调参数（miniprogram-api-typings 未收录，自行声明，
 * 全局挂载声明见 types/global.ts 的 declare global）。
 */
export interface AppRouteEvent {
  /** 当前页面路由，如 pages/global/index */
  path: string
  /** 页面 query 参数（已解码） */
  query?: Record<string, string>
  scene?: number
}

// ---------------------------------------------------------------------------
// 声明式事件定义（config/tracking.ts 的 TRACK_EVENT_DEFS 使用）
// ---------------------------------------------------------------------------

/** 事件组装上下文：定义表 props 映射函数可从这里取触发页与调用方参数 */
export interface TrackEventContext {
  /** 触发页路由（定义表 page 指定值，缺省为当前页） */
  page: string
  /** 调用方传入的业务参数（标量已归一为 { 字段名: 值 }） */
  params: Record<string, unknown>
}

/** 声明式事件定义：新增事件在 TRACK_EVENT_DEFS 加一行即可，调用方无需新写函数 */
export interface TrackEventDef {
  /** 上报到后端的点分事件名（event_name） */
  name: string
  /** 事件大类（event_type） */
  type: TrackEventType
  /** 固定触发页路由；缺省取当前页（自动 page.view / page.hide 不在此表） */
  page?: string
  /**
   * target 取值：外部参数的字段名。调用方传标量且定义了 target 时，标量直接作 target。
   * 缺省不带 target。
   */
  target?: string
  /**
   * props 字段映射：上报字段名 → 外部参数字段名（字符串透传），或映射函数
   * （接收上下文做转换 / 兜底，如 keyword 截断、来源页取当前路由）。
   */
  props?: Record<string, string | ((ctx: TrackEventContext) => unknown)>
  /** 必填参数：缺失或 trim 后为空时本次不上报（如搜索关键词） */
  required?: string[]
}

/** 调用方业务参数：对象或单个标量（标量自动映射到 target 或唯一 props 字段） */
export type TrackEventParams =
  Record<string, unknown> | string | number | boolean | null | undefined
