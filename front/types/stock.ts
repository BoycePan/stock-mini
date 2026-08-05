export interface StockInfo {
  code: string
  name: string
  type: string
  market: string
  board: string
  industry: string
  is_active: boolean
}

export interface StockQuote {
  code: string
  name: string
  open: number
  prev_close: number
  price: number
  high: number
  low: number
  volume: number
  amount: number
  date: string
  time: string
  turnover: number
  pct_change: number
}

export interface KlinePoint {
  time: string
  open: number
  high: number
  low: number
  close: number
  volume: number
  amount?: number
  turnover?: number
  pct_change?: number
}

export interface KlineResult {
  code: string
  scale: string
  klines: KlinePoint[]
  count: number
}

export interface SectorBoard {
  plate_code: string
  plate_name: string
  cid: number
}

export interface SectorMember extends StockInfo {
  price?: number
  pct_change?: number
}

export interface NewsItem {
  id?: string
  title: string
  url: string
  source?: string
  time?: string
  summary?: string
}

export interface NewsListResponse {
  code?: string
  keyword?: string
  count: number
  news: NewsItem[]
}

export interface AnnouncementItem {
  id: string
  title: string
  url: string
  time: string
  pdf?: string
}

export interface AnnouncementListResponse {
  code: string
  page: number
  count: number
  items: AnnouncementItem[]
}

export interface SectorMembersResponse {
  cid: number
  count: number
  stocks: string[]
}
