/**
 * 系统配置与公告类型（docs/API.md 八「前端配置与公告」）。
 *
 * - AppConfig：app_config 表读取时为「摊平」JSON 对象：分组→嵌套对象，单独项→顶层键，
 *   值已解析为 JSON（布尔 / 数字 / 字符串 / 对象）。
 * - Notice：notice 表公开端返回的公告，仅含「启用 + 命中分端 + 当前有效」，
 *   已按 pinned DESC, sort ASC 排序，config 已解析为对象。
 */

/** 广告位配置项（app_config cfg_type='display' 下发的 adConfig.bannerAd 条目） */
interface AdBannerConfig {
  /** 广告位 unit-id（<ad-custom unit-id>，流量主后台创建） */
  'unit-id': string
  /** 展示位置：homeTop / asiaTop / matalsTop / finance / minute-detail / finance-detail / us-top100 */
  location: string
  /** 是否启用（status=false 时前端不展示该广告位） */
  status: boolean
}

/** 广告配置分组（后端 adConfig 下发的全部广告位，见 utils/ad-config.ts resolveAdUnitId） */
export interface AdConfig {
  /** 原生模板广告位（<ad-custom>）列表 */
  bannerAd?: AdBannerConfig[]
}

/** 前端展示配置：分组→嵌套对象 / 单独项→顶层键，值已解析。
 *  单个配置键均可缺省（后台未创建 / 尚未下发时为 undefined，前端按「关闭」处理）。 */
export type AppConfig = Partial<{
  config: {
    homeShowTop100?: boolean
    homeShowTop100Dev?: boolean
    /** 分时页（packageQuote/pages/minute）入口开关（线上正式版） */
    canShowMinute?: boolean
    /** 分时页入口开关（开发版 / 体验版） */
    canShowMinuteDev?: boolean
  }
  /** 广告位配置（各页面按 location 查找 unit-id 渲染，见 components/ad-banner） */
  adConfig?: AdConfig
}>

export type NoticeType = 'notice' | 'banner' | 'marquee'

/** type 特有内容（icon / content / link / cover / subtitle …，枚举可扩展） */
export interface NoticeConfig {
  icon?: string
  content?: string
  link?: string
  cover?: string
  subtitle?: string
  /** 弹窗公告（position='home'，见 PopupNotice）：跳转路径 / 主按钮文案 / 版本门槛 / 展示天数 */
  path?: string
  buttonText?: string
  minVersion?: string
  count?: number
  /** 运行环境白名单：仅当当前小程序环境（develop / trial / release）在列表内才展示；缺省 / 空数组不限 */
  envWhitelist?: string[]
  [key: string]: unknown
}

export interface Notice {
  id: number
  type: NoticeType
  /** 标题 / 管理端列表标签 */
  title?: string
  /** 展示位置：settings / home / stock-detail … */
  position?: string
  sort: number
  pinned: boolean
  config: NoticeConfig
}

/**
 * 弹窗公告：页面进入时按规则弹出（components/popup-notice 渲染）。
 * 由服务端公告（/api/v1/notices，position='home'）的 config 下发驱动——
 * stores/system.store.ts 的 homePopupNotice 映射（utils/popup-notice.ts
 * resolveHomePopupNotice），管理端调整公告配置即时生效，无需发版。
 * 带 minVersion / count 两个「前端行为」字段，规则见 utils/popup-notice.ts。
 */
export interface PopupNotice {
  /** 弹窗标题（可选；缺省「公告」，每条公告可单独配置） */
  title?: string
  /** 公告正文，支持 HTML（rich-text 渲染，节点子集：p / strong / br / a 等） */
  content: string
  /** 点击跳转路径（小程序页面路径，空字符串 = 不跳转） */
  path: string
  /** 底部主按钮文案（可选；缺省：有跳转路径「立即查看」，否则「知道了」） */
  buttonText?: string
  /** 最低版本号：当前小程序版本 >= minVersion 才展示（点分数字比较，见 utils/version.ts） */
  minVersion: string
  /** 展示天数：自首次展示当天起连续展示 count 天，每天最多展示一次 */
  count: number
  /** 运行环境白名单：仅当当前小程序环境（develop / trial / release，见 utils/version.ts
   *  getAppEnvVersion）在列表内才展示；缺省 / 空数组不限 */
  envWhitelist?: string[]
}
