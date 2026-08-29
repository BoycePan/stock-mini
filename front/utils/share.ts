/**
 * 分享统一经首页中转：微信卡片分享 → 首页（pages/global/index）→ 自动跳转目标页。
 *
 * 背景：onShareAppMessage 未指定 path 时，分享卡片默认落在「当前页面」路径，
 * 接收方会被直接深链到 detail 页，绕过首页的启动初始化（登录、行情 store、主题等），
 * 冷启动直开 detail 页容易出现数据/状态缺失的问题。
 * 因此所有分享入口统一把 path 指向首页，并携带 target 标识与目标页参数；
 * 首页 onLoad 识别到 target 后自动 redirectTo 目标页，保证分享一定先经过首页。
 */

/** 分享入口统一指向的首页路径（app.json 首个页面，即小程序冷启动页） */
export const SHARE_HOME_PATH = 'pages/global/index'

/** 分享卡片统一配图（静态资源 CDN，建议 5:4 比例图） */
export const SHARE_IMAGE_URL =
  'https://jzo2o-pan-oss.oss-cn-hangzhou.aliyuncs.com/images/wx-stock-share_2.jpg'
// 'https://wx-stock-static.guyu.org.cn/resource/wx-stock-share.jpg?now=1787329299'

/** 分享目标页路由表：target 标识 → 页面路径（非 TabBar 页均位于分包内） */
const SHARE_TARGET_ROUTES: Record<string, string> = {
  minute: '/packageQuote/pages/minute/index',
  'stock-detail': '/packageQuote/pages/stock-detail/index',
  'news-detail': '/packageNews/pages/news-detail/index',
  'sector-detail': '/packageQuote/pages/sector-detail/index',
}

/** 安全解码：微信 onLoad options 可能已被解码，避免重复解码抛 URIError */
function safeDecode(value: string | undefined): string {
  if (!value) return ''
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

/**
 * 构造 URL query 字符串（统一 encodeURIComponent，跳过空值）。
 * 用于 onShareTimeline 等不经首页中转、直接把参数拼进当前页 query 的分享场景。
 */
export function buildShareQuery(params: Record<string, string | undefined>): string {
  const query: string[] = []
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === '') continue
    query.push(`${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
  }
  return query.join('&')
}

/**
 * 构造「经首页中转」的分享 path（分享卡片 path 与分享原图的 entrancePath 共用）。
 *
 * 注意：分享路径统一**不带前导斜杠**（如 `pages/global/index?target=minute&...`），
 * 由 SHARE_HOME_PATH 本身保证；微信对转发 path 与 entrancePath 均接受该格式。
 * @param target 目标页标识（见 SHARE_TARGET_ROUTES）
 * @param params 目标页参数（原样传入，内部统一 encodeURIComponent）
 */
export function buildSharePath(
  target: string,
  params: Record<string, string | undefined> = {},
): string {
  const query = buildShareQuery({ ...params, target })
  return `${SHARE_HOME_PATH}?${query}`
}

/**
 * 首页 onLoad 调用：识别分享中转参数并自动跳转目标页。
 * 目标页未登记或缺少 target 时返回 false（首页正常渲染）；已跳转返回 true，
 * 调用方应立即终止页面后续初始化（绑定、数据加载、自动刷新等）。
 */
export function redirectFromShare(options: Record<string, string | undefined>): boolean {
  const target = safeDecode(options.target)
  const route = SHARE_TARGET_ROUTES[target]
  if (!route) return false
  const query: string[] = []
  for (const [key, value] of Object.entries(options)) {
    if (key === 'target' || value === undefined || value === '') continue
    query.push(`${encodeURIComponent(key)}=${encodeURIComponent(safeDecode(value))}`)
  }
  wx.redirectTo({ url: query.length > 0 ? `${route}?${query.join('&')}` : route })
  return true
}
