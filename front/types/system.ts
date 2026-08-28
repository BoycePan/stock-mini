/**
 * 系统配置与公告类型（docs/API.md 八「前端配置与公告」）。
 *
 * - AppConfig：app_config 表读取时为「摊平」JSON 对象：分组→嵌套对象，单独项→顶层键，
 *   值已解析为 JSON（布尔 / 数字 / 字符串 / 对象）。
 * - Notice：notice 表公开端返回的公告，仅含「启用 + 命中分端 + 当前有效」，
 *   已按 pinned DESC, sort ASC 排序，config 已解析为对象。
 */

/** 前端展示配置：分组→嵌套对象 / 单独项→顶层键，值已解析 */
export type AppConfig = Record<string, unknown>

export type NoticeType = 'notice' | 'banner' | 'marquee'

/** type 特有内容（icon / content / link / cover / subtitle …，枚举可扩展） */
export interface NoticeConfig {
  icon?: string
  content?: string
  link?: string
  cover?: string
  subtitle?: string
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
