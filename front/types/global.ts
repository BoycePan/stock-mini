/** 全球指数列表项（GET /api/v1/index/list） */
export interface GlobalIndex {
  code: string
  name: string
  market: string
  price: number | null
  pctChange: number | null
  updatedAt: string
  tradingHours: string
  isTrading: boolean
}

/** 全球板块列表项（GET /api/v1/global-sector/list） */
export interface GlobalSector {
  code: string
  name: string
  market: string
  board: 'industry' | 'theme'
  price: number | null
  pctChange: number | null
  updatedAt: string
  tradingHours: string
  isTrading: boolean
}

/** 全球资产列表项（GET /api/v1/asset/list），type 为 commodity/forex/crypto/bond/stock */
export interface GlobalAsset {
  code: string
  name: string
  type: 'commodity' | 'forex' | 'crypto' | 'bond' | 'us-stock' | string
  market: string
  board: string
  price: number | null
  pctChange: number | null
  updatedAt: string
  tradingHours: string
  isTrading: boolean
}

/** 实时行情（GET /api/v1/{index|global-sector|asset}/{code}/quote） */
export interface GlobalQuote {
  symbol: string
  price: number
  currency?: string
  exchange?: string
}
