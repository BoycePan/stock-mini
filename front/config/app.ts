import { getAccountInfo } from '../utils/account-info'

/**
 * 小程序 AppID 集合（const 对象而非 enum：Node strip-types 测试环境不支持 TS enum，
 * 且本仓库无外部代码把 AppId 当类型用；值语义与 enum 完全一致）
 */
export const AppId = {
  MarketTracker: 'wx2cfd1556edf21a24',
  HangQingTracker: 'wx0ecd2049e54fbca8',
} as const

/** AppId 值类型（如后续需要把 AppId 当类型用） */
export type AppId = (typeof AppId)[keyof typeof AppId]

/** AppID → 小程序展示名称 映射表（新增小程序在这里登记） */
const APP_BRANDS: Record<string, string> = {
  [AppId.MarketTracker]: '市场追踪助手',
  [AppId.HangQingTracker]: '行情追踪助手',
}

/** AppID → 登录接口 source 参数值（与后端约定的来源标识，新增小程序在这里登记） */
const APP_LOGIN_SOURCES: Record<string, string> = {
  [AppId.MarketTracker]: 'shiChang-tracker',
  [AppId.HangQingTracker]: 'hangQing-tracker',
}

/** 未登记 AppID 时的兜底名称（本仓库默认小程序） */
const FALLBACK_APP_NAME = '市场追踪助手'

/** 未登记 AppID 时的兜底登录 source（与兜底名称对应的默认小程序） */
const FALLBACK_LOGIN_SOURCE: string = APP_LOGIN_SOURCES[AppId.MarketTracker] ?? 'shiChang-tracker'

/** 当前小程序 AppID；wx 不可用（如单测环境）或读取失败时返回空串 */
function getCurrentAppId(): string {
  return getAccountInfo()?.miniProgram?.appId || ''
}

/** 按 AppID 解析展示名称；未登记时回退默认名称（纯函数，便于单测） */
export function resolveAppName(appId: string): string {
  return APP_BRANDS[appId] || FALLBACK_APP_NAME
}

/** 按 AppID 解析登录 source 参数值；未登记时回退默认 source（纯函数，便于单测） */
export function resolveLoginSource(appId: string): string {
  return APP_LOGIN_SOURCES[appId] || FALLBACK_LOGIN_SOURCE
}

const currentAppId = getCurrentAppId()

/** 当前小程序 AppID（调试 / 埋点 / 按 AppID 差异化逻辑可用） */
export const APP_ID: string = currentAppId

/** 当前小程序展示名称（按 AppID 自动匹配，模块加载时计算一次并缓存） */
export const APP_NAME: string = resolveAppName(currentAppId)

/** 当前小程序登录 source 参数值（按 AppID 自动匹配，模块加载时计算一次并缓存） */
export const LOGIN_SOURCE: string = resolveLoginSource(currentAppId)
