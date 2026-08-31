/**
 * 小程序版本号读取
 *
 * 优先使用微信运行时上报的「线上小程序版本号」（wx.getAccountInfoSync().miniProgram.version）：
 * 体验版 / 正式版中该值就是上传时的发版版本号（与 scripts/upload.ts 上传的版本一致），
 * 发版后自动跟随，无需改动代码；
 * 开发版（微信开发者工具）中该字段为空，回退到 FALLBACK_VERSION —— 该常量需与仓库根
 * package.json 的 version 保持一致，仅用于开发态展示。
 */
const FALLBACK_VERSION = '1.1.1'

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

/**
 * 点分版本号比较（如 "1.8.6"）。逐段按数字比较，缺段补 0：
 * - "1.8.6" vs "1.8.5" → 1
 * - "1.10.0" vs "1.9.9" → 1（数字比较，非字符串比较）
 * - "1.8" vs "1.8.0" → 0
 * 纯函数，便于单测。
 */
export function compareVersion(a: string, b: string): number {
  const pa = a
    .trim()
    .split('.')
    .map((s) => parseInt(s, 10))
  const pb = b
    .trim()
    .split('.')
    .map((s) => parseInt(s, 10))
  const len = Math.max(pa.length, pb.length)
  for (let i = 0; i < len; i++) {
    const x = Number.isNaN(pa[i]) ? 0 : (pa[i] ?? 0)
    const y = Number.isNaN(pb[i]) ? 0 : (pb[i] ?? 0)
    if (x > y) return 1
    if (x < y) return -1
  }
  return 0
}

/** 当前版本是否 >= 最低版本（minVersion 门槛校验，如弹窗公告） */
export function isVersionGte(current: string, min: string): boolean {
  return compareVersion(current, min) >= 0
}
