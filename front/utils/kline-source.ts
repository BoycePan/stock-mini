/**
 * 分时页「日/周/月/年 K」多源兜底链 + 周期聚合（纯前端，国内直连）。
 *
 * 链路（近周期优先，命中即返回；单源失败自动降级，不抛错）：
 *   日 K：腾讯 day → 新浪 day
 *   周 K：腾讯 week → 新浪 week（仅 A股）→ 日 K 聚合
 *   月 K：腾讯 month → 周 K 聚合 → 日 K 聚合
 *   年 K：月 K 聚合 → 周 K 聚合 → 日 K 聚合（年 K 无任何国内直连源，必须聚合）
 *
 * 聚合之所以是必需能力而不只是兜底：腾讯对韩股等市场的周/月线只返回 1 根（当日），
 * 直接展示等于空图；聚合到细周期可拿到真实历史（日 K 全量 → 周/月/年）。
 * 因此聚合结果不足 2 根时继续向更细周期回退。
 *
 * 结果按 (code, 周期, 根数) 做 60s 内存缓存：TAB 来回切换不重复请求；
 * 腾讯代码候选（美股 .OQ/.N/.A）首次探测命中后固定，后续不再重复试错。
 */

import type { KlinePoint } from '../types/stock'
import { aggregateKlines } from './kline'
import { klineApi, type SinaKlineKind } from '../api/kline'
import { resolveKlineSources, type KlineSources } from '../config/kline'
import { MIN_KLINE_BARS } from './kline-parser'

/** 分时页 K 线 TAB 周期 */
export type KlineTab = 'day' | 'week' | 'month' | 'year'

export interface KlineSeriesResult {
  klines: KlinePoint[]
  /** 数据来源展示文案 */
  sourceLabel: string
  /** 口径提示（如现货用期货日线代理），来自 config/kline.ts */
  note?: string
  /** 是否由更细周期聚合而来（年 K 恒为 true） */
  aggregated: boolean
}

/** 请求根数：日 K 用于聚合月/年时需要更长历史 */
const DAY_COUNT = 500
const DAY_COUNT_DEEP = 1200
const WEEK_COUNT = 320
const MONTH_COUNT = 300
/** 缓存有效期：TAB 来回切换 / 下拉刷新之间的复用窗口 */
const CACHE_TTL = 60_000

interface RawSeries {
  klines: KlinePoint[]
  sourceLabel: string
}

/** TAB 级结果缓存（含聚合结果），key = `${code}|${tab}` */
const seriesCache = new Map<string, { at: number; value: KlineSeriesResult | null }>()
/** 细周期原始取数缓存，key = `${code}|raw|${unit}|${count}`（聚合多周期共用，避免重复请求） */
const rawCache = new Map<string, { at: number; value: RawSeries | null }>()
/** 腾讯 K 线代码候选命中记录（code → 命中的腾讯代码），避免每次重新探测后缀 */
const tcCodeCache = new Map<string, string>()

/** 取周期 key（与 config/kline.ts 的 resolveKlineSources 同源） */
export function klineTabPeriods(): KlineTab[] {
  return ['day', 'week', 'month', 'year']
}

/** 该标的是否有 K 线数据源（TAB 是否可用） */
export { hasKlineSources } from '../config/kline'

/**
 * 拉取指定周期的 K 线（含聚合兜底与缓存）。
 * 无源 / 全部源失败返回 null（调用方展示「该周期暂无数据」空态，TAB 保持可切换）。
 */
export async function fetchKlineSeries(
  code: string,
  tab: KlineTab,
): Promise<KlineSeriesResult | null> {
  const sources = resolveKlineSources(code)
  if (!sources || !code) return null
  const cacheKey = `${code}|${tab}`
  const cached = seriesCache.get(cacheKey)
  if (cached && Date.now() - cached.at < CACHE_TTL) return cached.value

  const result = await loadSeries(code, sources, tab)
  seriesCache.set(cacheKey, { at: Date.now(), value: result })
  return result
}

/** 清空 K 线缓存（下拉刷新强制取新数据时调用） */
export function clearKlineCache(code?: string): void {
  if (!code) {
    seriesCache.clear()
    rawCache.clear()
    return
  }
  for (const key of Array.from(seriesCache.keys())) {
    if (key.startsWith(`${code}|`)) seriesCache.delete(key)
  }
  for (const key of Array.from(rawCache.keys())) {
    if (key.startsWith(`${code}|`)) rawCache.delete(key)
  }
}

async function loadSeries(
  code: string,
  sources: KlineSources,
  tab: KlineTab,
): Promise<KlineSeriesResult | null> {
  const note = sources.note
  const direct = async (unit: 'day' | 'week' | 'month', count: number) =>
    fetchRawCached(code, sources, unit, count)

  if (tab === 'day') {
    const raw = await direct('day', DAY_COUNT)
    return raw
      ? { klines: raw.klines, sourceLabel: raw.sourceLabel, note, aggregated: false }
      : null
  }

  if (tab === 'week') {
    const raw = await direct('week', WEEK_COUNT)
    if (raw && raw.klines.length >= MIN_KLINE_BARS) {
      return { klines: raw.klines, sourceLabel: raw.sourceLabel, note, aggregated: false }
    }
    return aggregateFrom(code, sources, 'week', [{ unit: 'day', count: DAY_COUNT }], note)
  }

  if (tab === 'month') {
    const raw = await direct('month', MONTH_COUNT)
    if (raw && raw.klines.length >= MIN_KLINE_BARS) {
      return { klines: raw.klines, sourceLabel: raw.sourceLabel, note, aggregated: false }
    }
    return aggregateFrom(
      code,
      sources,
      'month',
      [
        { unit: 'week', count: WEEK_COUNT },
        { unit: 'day', count: DAY_COUNT_DEEP },
      ],
      note,
    )
  }

  // 年 K：无直连源，一律聚合
  return aggregateFrom(
    code,
    sources,
    'year',
    [
      { unit: 'month', count: MONTH_COUNT },
      { unit: 'week', count: WEEK_COUNT },
      { unit: 'day', count: DAY_COUNT_DEEP },
    ],
    note,
  )
}

/** 依次尝试「取细周期 → 聚合到目标周期」，聚合结果不足 2 根时继续下一个细周期 */
async function aggregateFrom(
  code: string,
  sources: KlineSources,
  target: 'week' | 'month' | 'year',
  bases: Array<{ unit: 'day' | 'week' | 'month'; count: number }>,
  note?: string,
): Promise<KlineSeriesResult | null> {
  for (const base of bases) {
    if (base.unit === target) continue
    const raw = await fetchRawCached(code, sources, base.unit, base.count)
    if (!raw) continue
    const klines = aggregateKlines(raw.klines, target)
    if (klines.length < MIN_KLINE_BARS) continue
    return {
      klines,
      sourceLabel: `${raw.sourceLabel}（${periodLabel(target)}聚合）`,
      note,
      aggregated: true,
    }
  }
  return null
}

/** 单次细周期取数（带缓存）：腾讯候选 → 新浪 */
async function fetchRawCached(
  code: string,
  sources: KlineSources,
  unit: 'day' | 'week' | 'month',
  count: number,
): Promise<RawSeries | null> {
  const key = `${code}|raw|${unit}|${count}`
  const cached = rawCache.get(key)
  if (cached && Date.now() - cached.at < CACHE_TTL) return cached.value
  const value = await fetchRaw(sources, unit, count)
  rawCache.set(key, { at: Date.now(), value })
  return value
}

async function fetchRaw(
  sources: KlineSources,
  unit: 'day' | 'week' | 'month',
  count: number,
): Promise<RawSeries | null> {
  const candidates = orderTencentCandidates(sources.tc)
  for (const candidate of candidates) {
    const klines = await klineApi.tencent(candidate, unit, count)
    if (klines && klines.length >= MIN_KLINE_BARS) {
      if (sources.tc?.length) tcCodeCache.set(sources.tc.join(','), candidate)
      return { klines, sourceLabel: '腾讯K线' }
    }
  }
  const sina = sources.sina
  if (sina && (unit === 'day' || (unit === 'week' && sina.week))) {
    const klines = await klineApi.sina(
      sina.kind as SinaKlineKind,
      sina.symbol,
      unit === 'week' ? 'week' : 'day',
    )
    if (klines && klines.length >= MIN_KLINE_BARS) {
      return { klines, sourceLabel: '新浪K线' }
    }
  }
  return null
}

/** 候选排序：已探明的命中代码优先（首次按配置顺序探测） */
function orderTencentCandidates(candidates?: string[]): string[] {
  if (!candidates?.length) return []
  const hit = tcCodeCache.get(candidates.join(','))
  if (!hit) return candidates
  return [hit, ...candidates.filter((code) => code !== hit)]
}

function periodLabel(period: 'week' | 'month' | 'year'): string {
  if (period === 'week') return '周K'
  if (period === 'month') return '月K'
  return '年K'
}
