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

/** 当日分时图数据点（分钟级） */
export interface MinutePoint {
  /** 时间，如 "09:30"（东财/腾讯）或 "2026-08-19 09:31"（Yahoo epoch 转本地） */
  time: string
  /**
   * 完整时间戳 "YYYY-MM-DD HH:mm"（源自带日期时保留，如东财 "2026-08-19 09:30"、
   * Yahoo epoch 转本地；腾讯 HHmm 无日期信息则缺省）。
   * 供触摸浮层十字光标展示「年月日 时分」，跨零点时段（美股 21:30→04:00）逐点准确。
   */
  timeFull?: string
  /** 现价 */
  price: number
  /** 均价（累计成交额/累计成交量）；源未提供时为空 */
  avg: number | null
  /** 该分钟成交量 */
  volume: number
  amount?: number
}

/** 当日分时图数据（含昨收基准） */
export interface MinuteResult {
  /** 昨收（分时基准线），源未提供时为空 */
  preClose: number | null
  /**
   * 昨结算（期货口径的涨跌幅基准，如 SHFE 沪主连 / COMEX）：
   * 期货的「昨收」是昨日最后成交价（如 沪银 16771），而涨跌幅按「昨结算」（16611）计算，
   * 两者不同；非期货（股票 / 指数 / 汇率）无此字段或为 0。
   */
  preSettlement?: number | null
  points: MinutePoint[]
  /** 源返回的证券名（如东财美股「英伟达」），供代理股合成页标注中文名 */
  name?: string
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
  page?: number
  size?: number
  count: number
  hasMore?: boolean
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
