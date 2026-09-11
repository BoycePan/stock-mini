import type { KlineResult, StockInfo, StockQuote } from '../types/stock'
import { request } from './client'

export const stockApi = {
  search(keyword: string, limit = 20) {
    return request<{ keyword: string; count: number; stocks: StockInfo[] }>({
      path: '/api/v1/stock/search',
      query: { q: keyword, limit },
      // 后端 /api/v1/** 强制鉴权（除 auth）：必须带 Bearer token，否则返回「缺少 token」
      withAuth: true,
    })
  },
  getQuote(code: string) {
    return request<StockQuote>({ path: `/api/v1/stock/${code}/quote`, withAuth: true })
  },
  getQuotes(codes: string[]) {
    // 空数组直接短路，不发请求：codes.join(',') 得到空串，而 utils/request.ts 的 buildQuery
    // 会过滤掉空值参数 → 请求退化成不带 codes 的 /api/v1/stock/quotes，语义从「无标的」
    // 变成「未指定」（后端可能按全量返回或直接 400）。
    // 现有调用方（packageQuote/pages/sector-detail 的 buildMembers）在空列表时已提前 return，
    // 空结果与其期望一致。
    if (!codes.length) return Promise.resolve<StockQuote[]>([])
    return request<StockQuote[]>({
      path: '/api/v1/stock/quotes',
      query: { codes: codes.join(',') },
      withAuth: true,
    })
  },
  getKlines(code: string, scale = '240', count = 100) {
    return request<KlineResult>({
      path: `/api/v1/stock/${code}/klines`,
      query: { scale, count },
      withAuth: true,
    })
  },
}
