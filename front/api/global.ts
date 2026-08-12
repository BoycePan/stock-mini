import type { KlineResult } from '../types/stock'
import type { GlobalAsset, GlobalIndex, GlobalQuote, GlobalSector } from '../types/global'
import { request } from './client'

/** 全球资产 type 参数（asset/list 必填） */
export type GlobalAssetType = 'commodity' | 'forex' | 'crypto' | 'bond' | 'stock'

/** 全球市场数据接口：雅虎 Finance 指数 / 板块 ETF / 商品外汇加密美债美股 */
export const globalApi = {
  /** 全球指数列表（GET /api/v1/index/list） */
  getIndices() {
    return request<GlobalIndex[]>({ path: '/api/v1/index/list' })
  },
  /** 全球板块列表（GET /api/v1/global-sector/list），market 不传返回全部 */
  getSectors(market?: 'us' | 'global') {
    return request<GlobalSector[]>({
      path: '/api/v1/global-sector/list',
      query: market ? { market } : undefined,
    })
  },
  /** 全球资产列表（GET /api/v1/asset/list） */
  getAssets(type: GlobalAssetType, market?: 'us' | 'global') {
    return request<GlobalAsset[]>({
      path: '/api/v1/asset/list',
      query: { type, ...(market ? { market } : {}) },
    })
  },
  /** 指数 K线（GET /api/v1/index/{code}/klines） */
  getIndexKlines(code: string, range = '1y') {
    return request<KlineResult>({ path: `/api/v1/index/${code}/klines`, query: { range } })
  },
  /** 指数实时行情（GET /api/v1/index/{code}/quote） */
  getIndexQuote(code: string) {
    return request<GlobalQuote>({ path: `/api/v1/index/${code}/quote` })
  },
  /** 板块 K线（GET /api/v1/global-sector/{code}/klines） */
  getSectorKlines(code: string, range = '1y') {
    return request<KlineResult>({ path: `/api/v1/global-sector/${code}/klines`, query: { range } })
  },
  /** 板块实时行情（GET /api/v1/global-sector/{code}/quote） */
  getSectorQuote(code: string) {
    return request<GlobalQuote>({ path: `/api/v1/global-sector/${code}/quote` })
  },
  /** 资产 K线（GET /api/v1/asset/{code}/klines） */
  getAssetKlines(code: string, range = '1y') {
    return request<KlineResult>({ path: `/api/v1/asset/${code}/klines`, query: { range } })
  },
  /** 资产实时行情（GET /api/v1/asset/{code}/quote） */
  getAssetQuote(code: string) {
    return request<GlobalQuote>({ path: `/api/v1/asset/${code}/quote` })
  },
}
