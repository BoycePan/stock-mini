export type MarketTone = 'global' | 'asia' | 'metals' | 'finance'

export interface MarketMetric {
  id: string
  /** 行情代码（如 sh000001 / KS11 / GOLD），用于卡片点击查看日K时定位数据源；新闻等无行情条目缺省 */
  code?: string
  /**
   * 分时取数专用代码：与展示 code 不同（随会话切换口径，如 外盘 GOLD → GOLD-US 取 COMEX）。
   * 缺省时直接用 code 取分时；无对应源时该卡片不显示「分时」入口。
   */
  minuteCode?: string
  /** 无分时源时点击卡片的提示文案（覆盖默认「该指标暂无分时数据」） */
  minuteUnavailableTip?: string
  name: string
  value: string
  change: number
  unit?: string
  icon?: string
  /**
   * 指标名称旁图标图片路径（本地静态图，如 /static/icons/...）。
   * 有值时优先于 icon（Emoji）渲染；无值时回退 icon。
   */
  iconImage?: string
  /** 指标名称旁的小徽标（如「个股」、代表金属「钼」），按序展示 */
  tags?: string[]
  updatedAt?: string
  /** 无涨跌幅（缺失或恰好为 0）时隐藏涨跌徽标，避免展示无意义的「— —」 */
  hideChange?: boolean
  /** 不出现在分享海报中（如「市值TOP100」入口卡，海报里无行情语义） */
  hideFromPoster?: boolean
  /** 点击查看详情时透传的扩展数据（如新闻标题/摘要/原文链接） */
  detail?: Record<string, string | undefined>
}

export interface MarketSection {
  id: string
  title: string
  tone: MarketTone
  badge?: string
  /** 有值时标题右侧显示「i」说明图标，点击弹窗展示该提示文案 */
  tip?: string
  tipTitle?: string
  metrics: MarketMetric[]
  /** 单行布局：无价格条目（如行业板块只有涨跌幅）时，名称与涨跌幅并排一行展示 */
  singleLine?: boolean
  /**
   * 整个面板右上角以单个「分时」角标提示（如行业板块），
   * 代替逐卡片内联「分时」标签；仅在该面板内指标支持分时图时置 true。
   */
  minuteCorner?: boolean
  /** 标题右侧盘面状态文案（如 盘中 / 午休 / 盘后 / 集合竞价 / 休市），仅部分市场板块展示 */
  marketStatus?: string
  /** 盘面状态色调：active=盘中 / quiet=盘后午休集合竞价等 / rest=休市 */
  marketTone?: 'active' | 'quiet' | 'rest'
}

export interface MarketPageData {
  statusLabel: string
  statusTone: 'active' | 'rest'
  updatedLabel: string
  sections: MarketSection[]
}
