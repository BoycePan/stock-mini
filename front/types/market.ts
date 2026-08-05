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
