/**
 * 多源行情聚合逻辑（docs/tabbar-api.md「五、公共逻辑」）。
 *
 * - fetchAccurate：多源共识聚合（并行前 N 个源 → 相似归并取中位数 → 不足补拉剩余源）；
 * - fetchAShareBoardChangeMap / fetchUsProxyChangeMap：行业板块涨跌幅（A股时段 / 美股时段）；
 * - fetchAShareMulti：单只 A 股标的多源聚合（腾讯 → 新浪A股 → 东财）。
 */

import {
  fetchEastmoneyList,
  fetchEastmoneyQuote,
  fetchSinaQuotes,
  fetchTencentQuotes,
} from '../api/quote'
import type {
  QuoteSource,
  QuoteSourceKind,
  SinaQuote,
  SourceQuote,
  TencentQuote,
} from '../types/quote'
import { aShareSecid, bareCode, findConsensus, toArray, type SimilarTols } from './quote-consensus'
import { isAbnormalPct, parseSinaQuote, sinaGbProxyPct, validateQuote } from './quote-parser'

/** 多源聚合时可复用的预取数据，避免同一 key 被重复请求 */
export interface QuoteBatch {
  sina?: Map<string, SinaQuote>
  tencent?: Map<string, TencentQuote>
}

export interface FetchAccurateOptions {
  /** 每批并发源数量，默认 2 */
  parallel?: number
  /** 相对容差，默认 0.01 */
  relTol?: number
  /** 绝对容差，默认 0.02 */
  absTol?: number
  /** 涨跌幅容差（%），默认 0.5 */
  pctTol?: number
}

/** 来源优先级（数字越小越优先，作为基准源排序，docs 5.1） */
const SOURCE_PRIORITY: Record<QuoteSourceKind, number> = {
  sina_hf: 1,
  sina_nf: 1,
  sina_znb: 1,
  sina_diniw: 1,
  sina_ashare: 2,
  sina_gb: 2,
  sina_fx: 3,
  tencent: 2,
  em: 4,
}

function sourceName(kind: QuoteSourceKind): string {
  if (kind === 'em') return 'em'
  if (kind === 'tencent') return 'tencent'
  return kind
}

/** 归一化 + 区间 / 涨跌幅校验；不通过返回 null */
function toSourceQuote(
  source: QuoteSource,
  price: number | null,
  previousClose: number | null,
  change: number | null,
  changePercent: number | null,
  name: string | undefined,
): SourceQuote | null {
  if (price === null || !validateQuote(price, source.min, source.max)) return null
  let pct = changePercent
  if (pct === null && change !== null && previousClose && previousClose !== 0) {
    pct = (change / previousClose) * 100
  }
  if (pct !== null && isAbnormalPct(pct)) return null
  return {
    price,
    previousClose,
    change,
    changePercent: pct,
    name,
    source: sourceName(source.kind),
  }
}

/** 拉取单个源（优先复用预取 batch） */
async function fetchOne(source: QuoteSource, batch: QuoteBatch): Promise<SourceQuote | null> {
  const kind = source.kind

  if (kind.startsWith('sina')) {
    for (const key of toArray(source.key)) {
      if (!key) continue
      let quote = batch.sina?.get(key)
      if (!quote) {
        const rows = await fetchSinaQuotes([key])
        quote = parseSinaQuote(key, rows[0]?.fields ?? [])
      }
      const result = toSourceQuote(
        source,
        quote.price,
        quote.previousClose,
        quote.change,
        quote.changePercent,
        undefined,
      )
      if (result) return result
    }
    return null
  }

  if (kind === 'tencent') {
    for (const code of toArray(source.key)) {
      if (!code) continue
      let quote: TencentQuote | undefined = batch.tencent?.get(code)
      if (!quote) {
        const rows = await fetchTencentQuotes([code])
        quote = rows[0] ?? undefined
      }
      if (!quote || !quote.valid) continue
      const result = toSourceQuote(
        source,
        quote.latestPrice,
        quote.previousClose,
        quote.change,
        quote.changePercent,
        quote.name,
      )
      if (result) return result
    }
    return null
  }

  // em：多个 secid 逐个尝试（如 105.TLT → 106.TLT → 107.TLT）
  for (const secid of toArray(source.secid)) {
    if (!secid) continue
    const quote = await fetchEastmoneyQuote(secid)
    if (!quote || quote.latestPrice === null) continue
    const result = toSourceQuote(
      source,
      quote.latestPrice,
      quote.previousClose,
      quote.change,
      quote.changePercent,
      quote.name,
    )
    if (result) return result
  }
  return null
}

/**
 * 多源共识聚合（docs 5.1）：
 * 按来源优先级排序 → 每批并发拉取 parallel 个源 → 出现 ≥2 个相似报价立即取中位数返回；
 * 全部拉完仍无共识则返回最高优先级首个有效报价（尽力而为），全部失败返回 null。
 */
export async function fetchAccurate(
  sources: QuoteSource[],
  batch: QuoteBatch = {},
  options: FetchAccurateOptions = {},
): Promise<SourceQuote | null> {
  const { parallel = 2, relTol = 0.01, absTol = 0.02, pctTol = 0.5 } = options
  const tols: SimilarTols = { relTol, absTol, pctTol }
  const ordered = [...sources].sort((a, b) => SOURCE_PRIORITY[a.kind] - SOURCE_PRIORITY[b.kind])
  if (!ordered.length) return null

  const valid: SourceQuote[] = []
  for (let index = 0; index < ordered.length; index += parallel) {
    const chunk = ordered.slice(index, index + parallel)
    const results = await Promise.all(chunk.map((source) => fetchOne(source, batch)))
    for (const result of results) {
      if (result && result.price !== null) valid.push(result)
    }
    const consensus = findConsensus(valid, tols)
    if (consensus) return consensus
  }
  return valid[0] ?? null
}

// ---------------------------------------------------------------------------
// 行业板块涨跌幅
// ---------------------------------------------------------------------------

/**
 * A股时段板块涨跌幅（docs ④ fetchAShareBoardChangeMap）：
 * 入参为板块代码数组（['BK1134', …]），自动补 90. 前缀。
 * 出参 map 同时含完整 secid 与裸代码两个 key。
 */
export async function fetchAShareBoardChangeMap(codes: string[]): Promise<Record<string, number>> {
  if (!codes.length) return {}
  return fetchEastmoneyList(codes.map((code) => `90.${code}`))
}

/**
 * 非 A 股时段美股代理股涨跌幅（docs ④ fetchUsProxyChangeMap）：
 * 入参为带市场号的代理股数组（['105.NVDA', …]），新浪 gb_ 优先，东财 ulist 兜底合并。
 * 出参 map 同时含完整 secid 与裸代码两个 key。
 */
export async function fetchUsProxyChangeMap(proxies: string[]): Promise<Record<string, number>> {
  const result: Record<string, number> = {}
  if (!proxies.length) return result

  const sinaKeys = proxies.map((proxy) => `gb_${bareCode(proxy).toLowerCase()}`)
  const rows = await fetchSinaQuotes(sinaKeys)
  const pending: string[] = []
  rows.forEach((row, index) => {
    const proxy = proxies[index]
    if (!proxy) return
    const pct = sinaGbProxyPct(row.fields)
    if (pct !== null) {
      result[proxy] = pct
      result[bareCode(proxy)] = pct
    } else {
      pending.push(proxy)
    }
  })

  if (pending.length) {
    const emMap = await fetchEastmoneyList(pending)
    for (const proxy of pending) {
      const pct = emMap[proxy] ?? emMap[bareCode(proxy)]
      if (pct !== undefined && Number.isFinite(pct)) {
        result[proxy] = pct
        result[bareCode(proxy)] = pct
      }
    }
  }
  return result
}

/**
 * 单只 A 股标的多源聚合（docs「AI 页 fetchAShareMulti」）：
 * ①腾讯（原样代码）→ ②新浪A股（小写代码）→ ③东财（sh→1.、sz→0. 前缀推导）。
 */
export async function fetchAShareMulti(code: string): Promise<SourceQuote | null> {
  const sources: QuoteSource[] = [
    { kind: 'tencent', key: code },
    { kind: 'sina_ashare', key: code.toLowerCase() },
    { kind: 'em', secid: aShareSecid(code) },
  ]
  return fetchAccurate(sources, {}, { parallel: 3 })
}
