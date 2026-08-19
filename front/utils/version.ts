/**
 * 小程序版本号读取
 *
 * 优先使用微信运行时上报的「线上小程序版本号」（wx.getAccountInfoSync().miniProgram.version）：
 * 体验版 / 正式版中该值就是上传时的发版版本号（与 scripts/upload.ts 上传的版本一致），
 * 发版后自动跟随，无需改动代码；
 * 开发版（微信开发者工具）中该字段为空，回退到 FALLBACK_VERSION —— 该常量需与仓库根
 * package.json 的 version 保持一致，仅用于开发态展示。
 */
const FALLBACK_VERSION = '1.0.2'

export function getAppVersion(): string {
  try {
    const account = wx.getAccountInfoSync()
    const version = account?.miniProgram?.version
    if (version && version.trim()) return version.trim()
  } catch {
    // wx 不可用（如单测环境）时走兜底
  }
  return FALLBACK_VERSION
}
