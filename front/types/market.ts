export type MarketTone = 'global' | 'asia' | 'metals' | 'finance'

export interface MarketMetric {
  id: string
  name: string
  value: string
  change: number
  unit?: string
  icon?: string
  updatedAt?: string
  /** 无涨跌幅时隐藏涨跌徽标（如汇率无有效涨跌幅数据） */
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
