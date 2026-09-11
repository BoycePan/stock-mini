/**
 * 市场会话判定（docs/tabbar-api.md 5.2）。
 *
 * - 纯时钟会话见 utils/market-clock.ts（可独立测试）；
 * - 实时会话（全球页）：并发探测 4 路腾讯行情（sh000001/sz399001/usIXIC/usINX），
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
import { quoteTimeToDate, quoteTimeToUtcMs } from './quote-parser'

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
  if (date === null) return false
  // 行情时间是北京墙钟：quoteTimeToDate 按设备本地时区构造，必须先还原为真实时刻再算年龄，
  // 否则非 UTC+8 设备（如美西）会把数小时前的行情算成负数年龄、恒判「新鲜」，
  // 导致收盘 / 周末仍报「A股盘中」并选中错误的数据源口径。
  return Date.now() - quoteTimeToUtcMs(date) <= FRESH_MS
}

/**
 * 全球页实时会话：
 * 传入 4 路腾讯指数行情（sh000001/sz399001/usIXIC/usINX，与展示数据同一次请求，见
 * api/market.ts getGlobalMarketPage）时直接用本次传入的行情计算；未传入则内部探测。
 * 按行情时间新鲜度修正时钟判定。
 *
 * 有 probes 时不参与 in-flight 去重（内部探测才需要去重）：调用方的 probes 与展示数据同源，
 * 若被另一路「无 probes 的内部探测」在途结果顶掉，本次会话就会用别人的探测快照算出来。
 * 这不增加任何请求（probes 已随展示请求拿到），30s 缓存照旧回写，缓存语义不变。
 */
export async function resolveGlobalMarketSession(probes?: TencentQuote[]): Promise<MarketSession> {
  const now = Date.now()
  if (globalSessionCache && now - globalSessionCache.at < SESSION_TTL) {
    return globalSessionCache.value
  }
  if (probes) {
    const value = sessionFromProbes(probes)
    globalSessionCache = { at: Date.now(), value }
    return value
  }
  if (!globalSessionInflight) {
    globalSessionInflight = (async () => {
      const quotes =
        probes ?? (await fetchTencentQuotes(['sh000001', 'sz399001', 'usIXIC', 'usINX']))
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
  const usFresh = isFreshQuote(byCode.get('usIXIC')) || isFreshQuote(byCode.get('usINX'))

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
