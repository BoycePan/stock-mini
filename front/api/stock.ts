import type { KlineResult, StockInfo, StockQuote } from '../types/stock'
import { request } from './client'

export const stockApi = {
  search(keyword: string, limit = 20) {
    return request<{ keyword: string; count: number; stocks: StockInfo[] }>({
      path: '/api/v1/stock/search',
      query: { q: keyword, limit },
    })
  },
  getQuote(code: string) {
    return request<StockQuote>({ path: `/api/v1/stock/${code}/quote` })
  },
  getQuotes(codes: string[]) {
    return request<StockQuote[]>({
      path: '/api/v1/stock/quotes',
      query: { codes: codes.join(',') },
    })
  },
  getKlines(code: string, scale = '240', count = 100) {
    return request<KlineResult>({
      path: `/api/v1/stock/${code}/klines`,
      query: { scale, count },
    })
  },
}
