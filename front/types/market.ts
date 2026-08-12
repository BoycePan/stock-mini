export type MarketDataSource = 'backend' | 'mock' | 'cache'
export type MarketTone = 'global' | 'asia' | 'metals' | 'ai'

export interface MarketMetric {
  id: string
  name: string
  value: string
  change: number
  unit?: string
  icon?: string
  source?: MarketDataSource
  updatedAt?: string
  /** 点击查看详情时透传的扩展数据（如新闻标题/摘要/原文链接） */
  detail?: Record<string, string | undefined>
}

export interface MarketSection {
  id: string
  title: string
  tone: MarketTone
  badge?: string
  metrics: MarketMetric[]
}

export interface MarketPageData {
  statusLabel: string
  statusTone: 'active' | 'rest'
  updatedLabel: string
  sections: MarketSection[]
  source: MarketDataSource
}
