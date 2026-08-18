export type MarketTone = 'global' | 'asia' | 'metals' | 'finance'

export interface MarketMetric {
  id: string
  name: string
  value: string
  change: number
  unit?: string
  icon?: string
  /** 指标名称旁的小徽标（如「个股」、代表金属「钼」），按序展示 */
  tags?: string[]
  updatedAt?: string
  /** 无涨跌幅（缺失或恰好为 0）时隐藏涨跌徽标，避免展示无意义的「— —」 */
  hideChange?: boolean
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
  metrics: MarketMetric[]
  /** 单行布局：无价格条目（如行业板块只有涨跌幅）时，名称与涨跌幅并排一行展示 */
  singleLine?: boolean
}

export interface MarketPageData {
  statusLabel: string
  statusTone: 'active' | 'rest'
  updatedLabel: string
  sections: MarketSection[]
}
