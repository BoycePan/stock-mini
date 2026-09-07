/**
 * 门户站点全局配置（单一数据源）。
 *
 * 品牌名与小程序 front/config/app.ts 的默认品牌保持一致（多小程序部署时，
 * 如需为「行情追踪助手」等品牌建站，可在此按品牌拆分配置；本期只服务默认品牌）。
 */

/** 站点品牌名称（与小程序默认品牌一致） */
export const APP_NAME = '市场追踪助手'

/** 站点品牌副标题（页面 / 页脚 / hero 等处展示） */
export const APP_TAGLINE = '免费 · 无广告 · 一屏看全球行情'

/** 站点 slogan（首页 hero 突出核心价值） */
export const APP_SLOGAN = '一屏看全球行情'

/** 站点描述（默认 meta description / OG description / WebSite JSON-LD 兜底）
 *  SEO：前置核心关键词，末尾带数据来源与「仅供参考」合规表述。 */
export const SITE_DESCRIPTION =
  '市场追踪助手是免费的微信小程序，一屏看齐 A股美股指数、宏观资产、行业板块、日韩行情、有色金属、42家金店金价与财经资讯，支持深浅双主题。数据来自公开接口聚合，可能有延迟，仅供参考，不构成投资建议。'

/**
 * 站点 URL（无尾斜杠）——线上正式域名。
 * robots.txt / canonical / OG url / sitemap 全部由本值推导（astro.config.mjs 的 site
 * 亦复用本配置），如需更换域名只改这一处即可。
 */
export const SITE_URL = 'https://stock-offical.guyu.org.cn'

/** 站点语言 */
export const SITE_LANG = 'zh-CN'

/**
 * 搜索引擎站长平台验证令牌（可选）。
 * 在百度搜索资源平台 / Google Search Console / Bing Webmaster 添加站点后，把对应 token
 * 填到这里，站点每个页面的 <head> 会输出验证 meta；留空则完全不输出。
 * - google：`google-site-verification` content
 * - baidu：`baidu-site-verification` content
 * - bing：`msvalidate.01` content
 */
export const SEO_VERIFICATION: { google?: string; baidu?: string; bing?: string } = {
  google: '',
  baidu: 'codeva-x2qvLaNqE0',
  bing: '',
}

/** 小程序码图片（public/ 下），上线前替换为微信公众平台生成的真实小程序码 */
export const MINIPROGRAM_CODE_IMAGE = '/miniprogram-code.png'

/** 品牌 logo（public/ 下） */
export const LOGO_IMAGE = '/logo.png'

/** 分享配图（OG / Twitter 大图，1200×630，public/ 下） */
export const OG_IMAGE = '/og.png'

/** 页脚免责声明（固定文案，全站可见） */
export const DISCLAIMER =
  '数据来自公开接口聚合（腾讯 / 新浪 / 东方财富 / 金投网等），可能存在延迟或误差，仅供参考，不构成任何投资建议。'

/** 微信内搜索名称（无法核实，发布前请自行确认实际可搜索到的名称） */
export const WECHAT_SEARCH_NAME = '市场追踪助手'

/** 全站声明：合规红线表述（功能、数据、不构成投资建议） */
export const NOTICE =
  '本网站仅作信息展示，不提供任何形式的投资建议或交易服务。行情数据来自公开接口聚合，可能有延迟，仅供参考。'

/** 运营主体信息（页脚 / Organization JSON-LD 复用） */
export const ORG = {
  name: '谷雨信息工作室',
  nameEn: 'Guyu Information Studio',
  city: '浙江杭州',
  icp: '浙ICP备2026046536号',
  police: '浙公网安备33010802014589号',
  policeUrl: 'https://www.beian.gov.cn/portal/registerSystemInfo?recordcode=33010802014589',
  icpUrl: 'https://beian.miit.gov.cn/',
} as const
