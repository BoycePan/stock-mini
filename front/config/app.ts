/** AppID → 小程序展示名称 映射表（新增小程序在这里登记） */
const APP_BRANDS: Record<string, string> = {
  wx2cfd1556edf21a24: '市场追踪助手',
  wx0ecd2049e54fbca8: '行情追踪助手',
}

/** 未登记 AppID 时的兜底名称（本仓库默认小程序） */
const FALLBACK_APP_NAME = '市场追踪助手'

/** 当前小程序 AppID；wx 不可用（如单测环境）或读取失败时返回空串 */
function getCurrentAppId(): string {
  try {
    const account = wx.getAccountInfoSync()
    return account?.miniProgram?.appId || ''
  } catch {
    return ''
  }
}

/** 按 AppID 解析展示名称；未登记时回退默认名称（纯函数，便于单测） */
export function resolveAppName(appId: string): string {
  return APP_BRANDS[appId] || FALLBACK_APP_NAME
}

const currentAppId = getCurrentAppId()

/** 当前小程序 AppID（调试 / 埋点 / 按 AppID 差异化逻辑可用） */
export const APP_ID: string = currentAppId

/** 当前小程序展示名称（按 AppID 自动匹配，模块加载时计算一次并缓存） */
export const APP_NAME: string = resolveAppName(currentAppId)
