/**
 * 分时页「日/周/月/年 K」多源兜底链 + 周期聚合 + 合成标的（纯前端，国内直连）。
 *
 * 链路（近周期优先，命中即返回；单源失败自动降级，不抛错）：
 *   日 K：东财（仅无腾讯/新浪源的标的）→ 腾讯 day → 新浪 day
 *   周 K：同上 week 源（直取过短时改用日 K 聚合）→ 日 K 聚合
 *   月 K：同上 month 源（直取过短时改用周 / 日 K 聚合）→ 周 K 聚合 → 日 K 聚合
 *   年 K：月 K 聚合 → 周 K 聚合 → 日 K 聚合（年 K 无任何国内直连源，必须聚合）
 * 源优先级可用 config 的 `sourceOrder` 覆盖（如费半 SOX 用新浪主源，见 config/kline.ts）。
 *
 * 数据质量校验（避免「有数据但数据是错的」）：
 *   腾讯对**错误的交易后缀**（如把纽交所标的当 `.OQ` 查）不只返回空，部分标的会返回
 *   「最早 500 根 + 最新 1 根」的补丁式序列——根数够、但近一年只有 1 根。命中后若被固定使用，
 *   美股板块代理合成会因公共交易日交集塌缩成 1 天而整板空态。故 hasPatchTail 命中时继续换源，
 *   但保留为最后兜底（换源不把原本有数据的标的变成空态）。
 *
 * 合成标的（与首页卡片、分时同口径，只有日线，周/月/年由日线聚合）：
 *   - 美股时段板块 us-BKxxxx：各代理股日线按基准日归一化到 100 后逐日取等权均值；
 *   - 交叉汇率 CNYKRW / CNYJPY：两腿日线逐日相除（分子 ÷ 分母）。
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
import { US_PROXY_NAMES } from '../config/minute'
import { MIN_KLINE_BARS, normalizeKlines } from './kline-parser'

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
/** 合成标的（代理股均值 / 交叉汇率）的日线根数：多腿请求，控制单次数据量（约 2 年交易日） */
const SYNTH_DAY_COUNT = 500
/** 缓存有效期：TAB 来回切换 / 下拉刷新之间的复用窗口 */
const CACHE_TTL = 60_000
/**
 * 「直接取到的序列偏短」的判定根数：周 / 月 TAB 直取结果短于此值时，改为比较「由更细周期聚合」
 * 的结果并用更长的那条（如东财新 secid `251.SOX` 只有 3 根月线，而新浪日线能聚合出 153 根月线）。
 */
const SHORT_SERIES_BARS = 12
/**
 * 相邻两根最大允许间隔（自然日）：用于识别腾讯对**错误交易后缀**返回的「最早 N 根 + 最新 1 根」
 * 补丁式序列（实测 usCOHR.OQ 500 根横跨 2021→2026、近一年仅 1 根）。正常日线间隔 ≤ 10 天左右，
 * 停牌股也只影响中段，末段间隔不会到几十天。
 */
const MAX_LAST_GAP_DAYS: Record<'day' | 'week' | 'month', number> = {
  day: 45,
  week: 120,
  month: 400,
}

interface RawSeries {
  klines: KlinePoint[]
  sourceLabel: string
  /** 取数时才知道的口径提示（合成标的的代理股清单 / 合成公式），有值时覆盖 config 的静态 note */
  note?: string
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
    tcCodeCache.clear()
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
  /** 取数口径提示：合成标的在取数时才知道清单 / 公式，优先于 config 静态说明 */
  const noteOf = (raw: RawSeries | null) => raw?.note ?? note
  const direct = async (unit: 'day' | 'week' | 'month', count: number) =>
    fetchRawCached(code, sources, unit, count)

  if (tab === 'day') {
    const raw = await direct('day', DAY_COUNT)
    return raw
      ? { klines: raw.klines, sourceLabel: raw.sourceLabel, note: noteOf(raw), aggregated: false }
      : null
  }

  if (tab === 'week') {
    const raw = await direct('week', WEEK_COUNT)
    const directOk = !!raw && raw.klines.length >= MIN_KLINE_BARS
    // 直取序列够长（正常情况下腾讯 / 东财周线都是几百根）→ 直接用，不多发请求
    if (directOk && raw.klines.length >= SHORT_SERIES_BARS) {
      return {
        klines: raw.klines,
        sourceLabel: raw.sourceLabel,
        note: noteOf(raw),
        aggregated: false,
      }
    }
    // 直取失败或过短（东财新 secid / 日韩个股历史短）→ 换成由日线聚合的更长序列
    const aggregated = await aggregateFrom(
      code,
      sources,
      'week',
      [{ unit: 'day', count: DAY_COUNT }],
      note,
    )
    if (aggregated && (!directOk || aggregated.klines.length > raw.klines.length)) return aggregated
    if (!directOk) return null
    return {
      klines: raw.klines,
      sourceLabel: raw.sourceLabel,
      note: noteOf(raw),
      aggregated: false,
    }
  }

  if (tab === 'month') {
    const raw = await direct('month', MONTH_COUNT)
    const directOk = !!raw && raw.klines.length >= MIN_KLINE_BARS
    if (directOk && raw.klines.length >= SHORT_SERIES_BARS) {
      return {
        klines: raw.klines,
        sourceLabel: raw.sourceLabel,
        note: noteOf(raw),
        aggregated: false,
      }
    }
    const aggregated = await aggregateFrom(
      code,
      sources,
      'month',
      [
        { unit: 'week', count: WEEK_COUNT },
        { unit: 'day', count: DAY_COUNT_DEEP },
      ],
      note,
    )
    if (aggregated && (!directOk || aggregated.klines.length > raw.klines.length)) return aggregated
    if (!directOk) return null
    return {
      klines: raw.klines,
      sourceLabel: raw.sourceLabel,
      note: noteOf(raw),
      aggregated: false,
    }
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

/**
 * 依次尝试「取细周期 → 聚合到目标周期」。
 * 目标周期为年时取首个聚合出 ≥2 根的细周期（与历史行为一致，避免为短历史标的额外多发请求）；
 * 周 / 月则继续向下比较：直取只有几根时（东财新 secid、日韩个股小盘标的等）用更细周期聚合出
 * 更长的历史，聚合根数达到 SHORT_SERIES_BARS 即提前结束。
 */
async function aggregateFrom(
  code: string,
  sources: KlineSources,
  target: 'week' | 'month' | 'year',
  bases: Array<{ unit: 'day' | 'week' | 'month'; count: number }>,
  note?: string,
): Promise<KlineSeriesResult | null> {
  const enough = target === 'year' ? MIN_KLINE_BARS : SHORT_SERIES_BARS
  let best: KlineSeriesResult | null = null
  for (const base of bases) {
    if (base.unit === target) continue
    const raw = await fetchRawCached(code, sources, base.unit, base.count)
    if (!raw) continue
    const klines = aggregateKlines(raw.klines, target)
    if (klines.length < MIN_KLINE_BARS) continue
    if (!best || klines.length > best.klines.length) {
      best = {
        klines,
        sourceLabel: `${raw.sourceLabel}（${periodLabel(target)}聚合）`,
        note: raw.note ?? note,
        aggregated: true,
      }
    }
    if (best.klines.length >= enough) break
  }
  return best
}

/** 是否合成标的（代理股均值 / 交叉汇率）：只有日线，且多腿请求的数据量与请求根数无关 */
function isSynthetic(sources: KlineSources): boolean {
  return !!sources.proxies?.length || !!sources.cross
}

/** 单次细周期取数（带缓存）：合成标的 → 东财 → 腾讯候选 → 新浪 */
async function fetchRawCached(
  code: string,
  sources: KlineSources,
  unit: 'day' | 'week' | 'month',
  count: number,
): Promise<RawSeries | null> {
  // 合成标的的日线根数固定（与请求周期无关）：缓存键与请求根数解耦，
  // 避免「月/年 TAB 用 1200 根」与「日 TAB 用 500 根」重复拉取同一批代理股数据
  const effectiveCount = isSynthetic(sources) ? SYNTH_DAY_COUNT : count
  const key = `${code}|raw|${unit}|${effectiveCount}`
  const cached = rawCache.get(key)
  if (cached && Date.now() - cached.at < CACHE_TTL) return cached.value
  const value = await fetchRaw(sources, unit, effectiveCount)
  rawCache.set(key, { at: Date.now(), value })
  return value
}

async function fetchRaw(
  sources: KlineSources,
  unit: 'day' | 'week' | 'month',
  count: number,
): Promise<RawSeries | null> {
  // 合成标的：只有日线（周 / 月 / 年由调用方用日线聚合），故非日线请求直接判空
  if (sources.proxies?.length) {
    return unit === 'day' ? fetchProxyComposite(sources.proxies, count) : null
  }
  if (sources.cross) {
    return unit === 'day' ? fetchCrossComposite(sources.cross, count) : null
  }

  /**
   * 形态可疑（补丁式序列）/ 历史偏短的备选结果：所有源都拿不到更好结果时用它，
   * 保证「换源」不会把原本有数据的标的变成空态（例如停牌股的短序列）。
   */
  let fallback: RawSeries | null = null
  const keepFallback = (raw: RawSeries) => {
    if (!fallback || raw.klines.length > fallback.klines.length) fallback = raw
  }

  for (const kind of sourceOrder(sources)) {
    // 东财（板块指数 / 国际指数 / A股平均股价 / 日韩个股）
    if (kind === 'em' && sources.em) {
      const klines = await klineApi.eastmoney(sources.em, unit, count)
      if (klines && klines.length >= MIN_KLINE_BARS) {
        const raw: RawSeries = { klines, sourceLabel: '东方财富K线' }
        if (!hasPatchTail(klines, unit)) return raw
        keepFallback(raw)
      }
      continue
    }
    // 腾讯（A股 / 港股 / 美股 / 外汇）：候选按序探测，命中即固定（仅限形态正常的序列）
    if (kind === 'tc') {
      for (const candidate of orderTencentCandidates(sources.tc)) {
        const klines = await klineApi.tencent(candidate, unit, count)
        if (!klines || klines.length < MIN_KLINE_BARS) continue
        const raw: RawSeries = { klines, sourceLabel: '腾讯K线' }
        // 补丁式序列（错误交易后缀的典型返回）不得固定为该代码：继续试下一候选 / 新浪
        if (hasPatchTail(klines, unit)) {
          keepFallback(raw)
          continue
        }
        if (sources.tc?.length) tcCodeCache.set(sources.tc.join(','), candidate)
        return raw
      }
      continue
    }
    // 新浪（期货 / 外盘 / 外汇 / A股与美股备用）：仅支持日线（A股另有周线 scale=1680）
    const sina = sources.sina
    if (kind === 'sina' && sina && (unit === 'day' || (unit === 'week' && sina.week))) {
      const klines = await klineApi.sina(
        sina.kind as SinaKlineKind,
        sina.symbol,
        unit === 'week' ? 'week' : 'day',
      )
      if (klines && klines.length >= MIN_KLINE_BARS) {
        const raw: RawSeries = { klines, sourceLabel: '新浪K线' }
        if (!hasPatchTail(klines, unit)) return raw
        keepFallback(raw)
      }
    }
  }
  return fallback
}

/** 源优先级（默认 东财 → 腾讯 → 新浪；config 可用 sourceOrder 覆盖，如 SOX 把新浪提到主源） */
function sourceOrder(sources: KlineSources): Array<'em' | 'tc' | 'sina'> {
  return sources.sourceOrder?.length ? sources.sourceOrder : ['em', 'tc', 'sina']
}

/**
 * 是否是「最早 N 根 + 最新 1 根」的补丁式序列（腾讯对错误交易后缀的返回形态）。
 * 判据：最后一根与倒数第二根的间隔超过该周期的合理上限（日线 45 天 / 周线 120 天 / 月线 400 天）。
 * 停牌只会拉大中段间隔，末段不会到几十天，因此不影响正常停牌股。
 */
function hasPatchTail(klines: KlinePoint[], unit: 'day' | 'week' | 'month'): boolean {
  if (klines.length < MIN_KLINE_BARS) return false
  const last = klines[klines.length - 1]
  const prev = klines[klines.length - 2]
  if (!last || !prev) return false
  const gap = (Date.parse(last.time) - Date.parse(prev.time)) / 86_400_000
  if (!Number.isFinite(gap)) return false
  return gap > MAX_LAST_GAP_DAYS[unit]
}

// ---------------------------------------------------------------------------
// 合成标的：美股代理股日线均值 / 交叉汇率两腿相除
// ---------------------------------------------------------------------------

/**
 * 美股板块（us-BKxxxx）代理股日线均值合成（与卡片展示的代理股涨跌幅均值、分时合成同口径）。
 *
 * 口径：各代理股日线按**公共交易日的首个交易日收盘**归一化到 100，再逐日对开/高/低/收取等权均值。
 * 只取全部可用代理股都有的日期（避免某只代理停牌造成单腿缺失时的假波动）；单只失败自动跳过，
 * 全部失败返回 null（由调用方展示空态）。成交量无合成口径（恒 0，图表自动隐藏量面板）。
 */
async function fetchProxyComposite(proxies: string[], count: number): Promise<RawSeries | null> {
  const dayCount = Math.min(count, SYNTH_DAY_COUNT)
  const results = await Promise.all(
    proxies.map(async (secid) => {
      const legSources = resolveKlineSources(secid)
      if (!legSources) return null
      const raw = await fetchRawCached(secid, legSources, 'day', dayCount)
      if (!raw || raw.klines.length < MIN_KLINE_BARS) return null
      return { secid, klines: raw.klines }
    }),
  )
  const legs = results.filter((item): item is { secid: string; klines: KlinePoint[] } => !!item)
  if (!legs.length) return null

  // 公共交易日：所有可用腿都有数据的日期（升序）
  const maps = legs.map((leg) => new Map(leg.klines.map((k) => [k.time, k])))
  const first = legs[0]
  if (!first) return null
  const dates = first.klines.map((k) => k.time).filter((time) => maps.every((m) => m.has(time)))
  if (dates.length < MIN_KLINE_BARS) return null

  const baseDate = dates[0]
  if (!baseDate) return null
  const scaled = maps.map((map) => {
    const base = map.get(baseDate)?.close ?? 0
    if (!base || base <= 0) return null
    const factor = 100 / base
    const series = new Map<string, KlinePoint>()
    for (const [time, bar] of map) {
      series.set(time, {
        time,
        open: bar.open * factor,
        high: bar.high * factor,
        low: bar.low * factor,
        close: bar.close * factor,
        volume: 0,
      })
    }
    return series
  })
  const validScaled = scaled.filter((item): item is Map<string, KlinePoint> => !!item)
  if (!validScaled.length) return null

  const bars: KlinePoint[] = []
  for (const time of dates) {
    const group = validScaled
      .map((series) => series.get(time))
      .filter((bar): bar is KlinePoint => !!bar)
    if (!group.length) continue
    bars.push({
      time,
      open: mean(group.map((bar) => bar.open)),
      high: mean(group.map((bar) => bar.high)),
      low: mean(group.map((bar) => bar.low)),
      close: mean(group.map((bar) => bar.close)),
      volume: 0,
    })
  }
  const klines = normalizeKlines(bars)
  if (!klines) return null

  return {
    klines,
    sourceLabel: '代理股日线均值合成',
    note: buildProxyNote(legs.map((leg) => leg.secid)),
  }
}

/** 合成图口径文案：列出代理股中文名（US_PROXY_NAMES 优先，兜底代码），最多 4 只 */
function buildProxyNote(secids: string[]): string {
  const shown = secids.slice(0, 4).map((secid) => {
    const ticker = secid.split('.')[1] ?? secid
    const name = US_PROXY_NAMES[ticker]
    return name ? `${name}(${ticker})` : ticker
  })
  const tail = secids.length > shown.length ? `等${secids.length}只` : ''
  return `由 ${shown.join('、')}${tail}美股代理股日线均值合成（基准=100，与卡片口径一致）`
}

/**
 * 交叉汇率（CNYKRW / CNYJPY）日线合成：两腿各取日线后**逐日相除**（分子 ÷ 分母）。
 * 比值 K 线的高低按保守口径取（分子最高 ÷ 分母最低、分子最低 ÷ 分母最高），
 * 两腿必须同日都有数据；成交量无口径（恒 0）。任一条腿失败返回 null。
 */
async function fetchCrossComposite(
  cross: { numerator: KlineSources; denominator: KlineSources },
  count: number,
): Promise<RawSeries | null> {
  const dayCount = Math.min(count, SYNTH_DAY_COUNT)
  const [numerator, denominator] = await Promise.all([
    fetchLeg(cross.numerator, dayCount),
    fetchLeg(cross.denominator, dayCount),
  ])
  if (!numerator || !denominator) return null
  const denominatorMap = new Map(denominator.klines.map((bar) => [bar.time, bar]))
  const bars: KlinePoint[] = []
  for (const bar of numerator.klines) {
    const base = denominatorMap.get(bar.time)
    if (!base || base.close <= 0 || base.open <= 0 || base.high <= 0 || base.low <= 0) continue
    bars.push({
      time: bar.time,
      open: bar.open / base.open,
      close: bar.close / base.close,
      high: bar.high / base.low,
      low: bar.low / base.high,
      volume: 0,
    })
  }
  const klines = normalizeKlines(bars)
  if (!klines) return null
  return { klines, sourceLabel: '两腿日线合成' }
}

/**
 * 合成标的的单腿取数（走上游兜底链 + 60s 缓存）。
 * 缓存键加 `#leg|` 前缀与真实卡片 code 隔离；两腿共用缓存，避免日/周/月 TAB 各拉一次整段历史
 * （新浪外汇日线是全量历史，重复拉取代价明显）。
 */
async function fetchLeg(leg: KlineSources, count: number): Promise<RawSeries | null> {
  return fetchRawCached(legCacheKey(leg), leg, 'day', count)
}

function legCacheKey(leg: KlineSources): string {
  if (leg.em) return `#leg|em|${leg.em}`
  if (leg.sina) return `#leg|sina|${leg.sina.kind}|${leg.sina.symbol}`
  if (leg.tc?.length) return `#leg|tc|${leg.tc.join(',')}`
  return '#leg|unknown'
}

function mean(values: number[]): number {
  if (!values.length) return 0
  return values.reduce((sum, value) => sum + value, 0) / values.length
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
