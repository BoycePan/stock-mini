/**
 * 市场会话判定（docs/tabbar-api.md 5.2）。
 *
 * - 纯时钟会话见 utils/market-clock.ts（可独立测试）；
 * - 实时会话（全球页）：并发探测 4 路腾讯行情（sh000001/sz399001/usQQQ/usSPY），
 *   按行情时间戳「新鲜度」（90min 陈旧阈值）修正时钟判定，带 30s 内存缓存 + in-flight 去重；
 * - 有色页会话：时钟判定国内/外盘（避免额外探测请求）。
 */

import { fetchTencentQuotes } from '../api/quote'
import type { TencentQuote } from '../types/quote'
import {
  getMarketSession,
  getNonferrousMarketSession,
  type MarketSession,
  type NonferrousSession,
} from './market-clock'
import { quoteTimeToDate } from './quote-parser'

export type { MarketSession, NonferrousSession } from './market-clock'

// ---------------------------------------------------------------------------
// 实时会话（30s 内存缓存 + in-flight 去重）
// ---------------------------------------------------------------------------

const SESSION_TTL = 30_000
/** 行情时间戳新鲜度阈值：距今 90min 内视为活跃（docs 5.2） */
const FRESH_MS = 90 * 60 * 1000

let globalSessionCache: { at: number; value: MarketSession } | null = null
let globalSessionInflight: Promise<MarketSession> | null = null

function isFreshQuote(quote: TencentQuote | undefined): boolean {
  if (!quote || !quote.valid) return false
  const date = quoteTimeToDate(quote.quoteTime)
  return date !== null && Date.now() - date.getTime() <= FRESH_MS
}

/**
 * 全球页实时会话：
 * 传入 4 路腾讯指数行情（sh000001/sz399001/usQQQ/usSPY，与展示数据同一次请求）时直接复用；
 * 未传入则内部探测。按行情时间新鲜度修正时钟判定。
 */
export async function resolveGlobalMarketSession(probes?: TencentQuote[]): Promise<MarketSession> {
  const now = Date.now()
  if (globalSessionCache && now - globalSessionCache.at < SESSION_TTL) {
    return globalSessionCache.value
  }
  if (!globalSessionInflight) {
    globalSessionInflight = (async () => {
      const quotes =
        probes ?? (await fetchTencentQuotes(['sh000001', 'sz399001', 'usQQQ', 'usSPY']))
      const value = sessionFromProbes(quotes)
      globalSessionCache = { at: Date.now(), value }
      return value
    })().finally(() => {
      globalSessionInflight = null
    })
  }
  return globalSessionInflight
}

function sessionFromProbes(quotes: TencentQuote[]): MarketSession {
  const clock = getMarketSession()
  const byCode = new Map(quotes.map((quote) => [quote.code, quote]))
  const aFresh = isFreshQuote(byCode.get('sh000001')) || isFreshQuote(byCode.get('sz399001'))
  const usFresh = isFreshQuote(byCode.get('usQQQ')) || isFreshQuote(byCode.get('usSPY'))

  if (aFresh && !usFresh) {
    return {
      ...clock,
      useA: true,
      useUs: false,
      usMode: 'off',
      phase: 'A股盘中',
      label: 'A股盘中',
      statusTone: 'active',
    }
  }
  if (usFresh && !aFresh) {
    return {
      ...clock,
      useA: false,
      useUs: true,
      phase: '美股盘中',
      label: '美股盘中',
      statusTone: 'active',
    }
  }
  if (aFresh && usFresh) {
    return {
      ...clock,
      useA: true,
      useUs: true,
      phase: '全球交易活跃',
      label: '全球交易活跃',
      statusTone: 'active',
    }
  }
  return clock
}

// ---------------------------------------------------------------------------
// 有色页会话（时钟判定 + 30s 缓存，无探测请求）
// ---------------------------------------------------------------------------

let nonferrousCache: { at: number; value: NonferrousSession } | null = null

export async function resolveNonferrousMarketSession(): Promise<NonferrousSession> {
  const now = Date.now()
  if (nonferrousCache && now - nonferrousCache.at < SESSION_TTL) {
    return nonferrousCache.value
  }
  const value = getNonferrousMarketSession(new Date())
  nonferrousCache = { at: now, value }
  return value
}
