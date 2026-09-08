/**
 * wx.getAccountInfoSync() 的惰性缓存读取。
 *
 * 该接口返回的是本次启动后基本不变的静态信息（AppID / 发版版本号 / 运行环境），
 * 且调用存在开销——弹窗公告调度（utils/popup-notice.ts）、接口环境判断
 * （config/env.ts isReleaseBuild）、AppID 解析（config/app.ts）等路径都会读取，
 * 故首次调用后缓存结果，后续读取直接命中缓存，不再重复调用 wx。
 *
 * wx 不可用（如单测环境）或读取失败时同样缓存 null：不反复抛错、不反复调用。
 * 测试注入不同的 wx mock 时，先调用 clearAccountInfoCache() 再设置 wx。
 */

/** 本仓库用到的账号信息字段（按需收窄 wx.getAccountInfoSync() 返回类型） */
export interface AccountInfo {
  miniProgram?: {
    appId?: string
    version?: string
    envVersion?: string
  }
}

/** undefined = 尚未读取；null = 读取失败 / wx 不可用；其余 = 缓存结果 */
let cached: AccountInfo | null | undefined

/** 读取当前小程序账号信息（首次调用后缓存，后续直接返回缓存） */
export function getAccountInfo(): AccountInfo | null {
  if (cached !== undefined) return cached
  try {
    cached = wx.getAccountInfoSync() ?? null
  } catch {
    cached = null
  }
  return cached
}

/** 清空缓存（测试注入不同 wx mock 时使用；线上运行无需调用） */
export function clearAccountInfoCache(): void {
  cached = undefined
}
