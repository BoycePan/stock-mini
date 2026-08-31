/**
 * 门户站点全局配置（单一数据源）。
 *
 * 品牌名与小程序 front/config/app.ts 的默认品牌保持一致（多小程序部署时，
 * 如需为「行情追踪助手」等品牌建站，可在此按品牌拆分配置；本期只服务默认品牌）。
 */

/** 站点品牌名称（与小程序默认品牌一致） */
export const APP_NAME = '市场追踪助手'

/** 站点品牌副标题（页面 / 页脚等处展示） */
export const APP_TAGLINE = '免费 · 无广告 · 一屏看全球行情'

/** 站点描述（默认 meta description / OG description 兜底） */
export const SITE_DESCRIPTION =
  '市场追踪助手是一款免费的微信小程序：A股美股指数、宏观资产、行业板块、日韩行情、有色金属、金店金价、财经新闻一屏看齐，支持深浅双主题，数据来自公开接口聚合，仅供参考。'

/**
 * 站点 URL（无尾斜杠）。
 * ⚠️ 上线前替换为真实域名，并同步 astro.config.mjs 的 site。
 * 部署变量说明见 docs/门户网站.md。
 */
export const SITE_URL = 'https://portal.example.com'

/** 站点语言 */
export const SITE_LANG = 'zh-CN'

/** 小程序码图片（public/ 下），上线前替换为微信公众平台生成的真实小程序码 */
export const MINIPROGRAM_CODE_IMAGE = '/miniprogram-code.png'

/** 品牌 logo（public/ 下） */
export const LOGO_IMAGE = '/logo.png'

/** 页脚免责声明（固定文案，全站可见） */
export const DISCLAIMER =
  '数据来自公开接口聚合（腾讯 / 新浪 / 东方财富 / 金投网等），可能存在延迟或误差，仅供参考，不构成任何投资建议。'

/** 微信内搜索名称（无法核实，发布前请自行确认实际可搜索到的名称） */
export const WECHAT_SEARCH_NAME = '市场追踪助手'
