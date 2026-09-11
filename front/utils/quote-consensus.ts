/**
 * 多源报价「共识聚合」的纯函数（docs/tabbar-api.md 5.1 相似判定 / 中位数归并）。
 *
 * 本模块不依赖任何网络请求 / 其他模块，可直接在 Node 测试中复用。
 */

import type { SourceQuote } from '../types/quote'

export interface SimilarTols {
  relTol: number
  absTol: number
  pctTol: number
}

function toArrayValue<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) return []
  return Array.isArray(value) ? value : [value]
}

/** 去掉市场前缀：105.NVDA → NVDA */
export function bareCode(marketCode: string): string {
  const index = marketCode.indexOf('.')
  return index >= 0 ? marketCode.slice(index + 1) : marketCode
}

/** A股行情代码 → 东财 secid：sh600519 → 1.600519、sz000001 → 0.000001、bj920010 → 0.920010 */
export function aShareSecid(code: string): string {
  // 前缀剥离大小写不敏感，市场判定却必须同样不敏感（否则 'SZ000001' 会被剥成 '000001' 却按
  // 1. 市场拼出 '1.000001'，东财返回空 → 该兜底源被静默跳过）；北交所 bj（4/8/92 开头）
  // 与深市同为 0. 市场。规则与 config/minute.ts 的 ashareEmSecid 保持一致。
  const lower = code.toLowerCase()
  const digits =
    lower.startsWith('sh') || lower.startsWith('sz') || lower.startsWith('bj')
      ? code.slice(2)
      : code
  return `${lower.startsWith('sh') ? '1' : '0'}.${digits}`
}

/**
 * 相似判定：绝对差 ≤ absTol 或 相对差 ≤ relTol 或 涨跌幅差 ≤ pctTol（docs 5.1）。
 * 任一满足即视为同源报价。
 */
export function similarQuotes(a: SourceQuote, b: SourceQuote, tols: SimilarTols): boolean {
  if (a.price === null || b.price === null) return false
  const absDiff = Math.abs(a.price - b.price)
  const denominator = Math.max(Math.abs(a.price), Math.abs(b.price))
  const relDiff = denominator > 0 ? absDiff / denominator : Infinity
  const pctDiff =
    a.changePercent !== null && b.changePercent !== null
      ? Math.abs(a.changePercent - b.changePercent)
      : Infinity
  return absDiff <= tols.absTol || relDiff <= tols.relTol || pctDiff <= tols.pctTol
}

function median(values: number[]): number {
  const sorted = [...values].sort((x, y) => x - y)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2
    ? (sorted[mid] as number)
    : ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2
}

/**
 * 找最大相似组并取中位数；组数 <2 返回 null（docs 5.1「组数 ≥2 才合并」）。
 */
export function findConsensus(quotes: SourceQuote[], tols: SimilarTols): SourceQuote | null {
  if (quotes.length < 2) return null
  let bestGroup: SourceQuote[] = []
  for (let i = 0; i < quotes.length; i++) {
    const pivot = quotes[i] as SourceQuote
    const group = [pivot]
    for (let j = 0; j < quotes.length; j++) {
      if (j !== i && similarQuotes(pivot, quotes[j] as SourceQuote, tols)) {
        group.push(quotes[j] as SourceQuote)
      }
    }
    if (group.length > bestGroup.length) bestGroup = group
  }
  if (bestGroup.length < 2) return null
  const medianOf = (pick: (q: SourceQuote) => number | null): number | null => {
    const nums = bestGroup.map(pick).filter((n): n is number => n !== null)
    return nums.length ? median(nums) : null
  }
  return {
    price: medianOf((q) => q.price),
    change: medianOf((q) => q.change),
    changePercent: medianOf((q) => q.changePercent),
    previousClose: medianOf((q) => q.previousClose),
    name: bestGroup[0]?.name,
    source: Array.from(new Set(bestGroup.map((q) => q.source))).join('+'),
  }
}

export { toArrayValue as toArray }
