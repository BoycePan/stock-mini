/**
 * 当日分时多源执行器：**按 config/minute.ts 的每 code 优先级从前到后依次尝试**
 * （缺省 腾讯分时 → 东财分时 → Yahoo，见 DEFAULT_MINUTE_PRIORITY），
 * 任一源命中即返回；请求失败 / 无数据 / 有效点数不足 时自动切下一个源。
 * 页面层只依赖本模块：传入卡片 code，返回归一化的分时数据与命中的源。
 *
 * 基础信息报价（今开/最高/最低/昨收/成交量）走独立的 quotePriority 链
 * （缺省 腾讯快照 qt.gtimg.cn → 东财 ulist），见 fetchMinuteBasicQuote。
 *
 * 源级失败熔断：某 code 的某个源失败后，短时间内不再重复尝试（分时页 8s 轮询 +
 * 微信 10 并发上限，避免一个必失败的源每轮都白打一次请求）；熔断到期后自动重试，
 * 因此「数据源恢复」不需要重启小程序。
 *
 * 美股时段行业板块（us-BKxxxx）：走「代理股分时均值合成」——
 * 卡片展示的正是美股代理股涨跌幅均值，分时同样对每只代理取东财 trends2
 * （归一化到昨收 100）后逐分钟取均值（跨零点对齐，基准=昨收100），口径完全一致；
 * 标注文案中代理股给出中文名（东财名，英文名用 US_PROXY_NAMES 补充表）。
 */

import type { MinutePoint, MinuteResult } from '../types/stock'
import type { EastmoneyUlistQuote, TencentQuote } from '../types/quote'
import { minuteApi } from '../api/minute'
import { fetchEastmoneyUlistQuote, fetchTencentQuote } from '../api/quote'
import {
  US_PROXY_NAMES,
  resolveMinutePlan,
  resolveMinuteQuotePlan,
  type MinutePlanStep,
  type MinuteSources,
} from '../config/minute'
import type { MinuteSessionKind } from './minute-session'
import {
  buildMinuteGrid,
  minuteToSlot,
  parseMinuteOfDay,
  resolveMinuteSession,
} from './minute-session'
import { bareCode } from './quote-consensus'
import {
  buildCompositePoints,
  buildCrossPoints,
  MIN_MINUTE_POINTS,
  type CompositeSeries,
} from './minute-parser'

export interface MinuteFetchResult extends MinuteResult {
  /** 命中的源：'em' | 'tc' | 'yahoo' */
  source: 'em' | 'tc' | 'yahoo'
  /** 数据来源展示文案（页面「数据来源」标签） */
  sourceLabel: string
  /** 展示提示（如代理标的说明），无则缺省 */
  note?: string
}

const SOURCE_LABELS: Record<MinuteFetchResult['source'], string> = {
  em: '东方财富分时',
  tc: '腾讯分时',
  yahoo: 'Yahoo 1分钟',
}

/** 分时源 kind → 归一化来源标记（合成类源均为东财口径合成，标记为 em） */
const KIND_TO_SOURCE: Record<MinutePlanStep['kind'], MinuteFetchResult['source']> = {
  tencent: 'tc',
  eastmoney: 'em',
  yahoo: 'yahoo',
  emProxies: 'em',
  emCross: 'em',
}

/** 代理股合成图的数据来源标签 */
const COMPOSITE_SOURCE_LABEL = '东方财富分时（美股代理合成）'
/** 交叉汇率合成图的数据来源标签 */
const CROSS_SOURCE_LABEL = '东方财富分时（交叉汇率合成）'

/**
 * 东财境外市场（韩股/日股）分钟量稀疏口径提示：
 * 东财 KRX/JPX 分钟源只在有成交记录的分钟挂量（实测三星电子约 43% 分钟量=0、东京电子约 36%，
 * 与 A 股同端点约 0% 不同）；命中东财源且无成交分钟占比 ≥20% 时给出口径提示，
 * 避免把「无成交记录」误读为「零成交」。Yahoo 兜底源逐分钟聚合，无需提示。
 */
export function sparseVolumeNote(
  points: MinutePoint[],
  source: MinuteFetchResult['source'],
  session: MinuteSessionKind,
): string {
  if (source !== 'em') return ''
  if (session !== 'kr' && session !== 'jp-yahoo') return ''
  const n = points.length
  if (!n) return ''
  const withVolume = points.filter((p) => (p.volume || 0) > 0).length
  if (withVolume / n >= 0.8) return ''
  return '成交量按东财逐笔聚合，部分分钟无成交记录'
}

/** 该卡片 code 是否支持当日分时图（任一源可用，供卡片「分时」角标展示） */
export { hasMinuteSources } from '../config/minute'

// ---------------------------------------------------------------------------
// 分时页「基础信息」：东财 ulist 报价（今开/最高/最低/昨收/成交量）优先，
// 缺字段 / 无报价（代理合成、交叉汇率、Yahoo 兜底等无单一 secid）时回退分时推算
// ---------------------------------------------------------------------------

/**
 * mergeMinuteQuoteInfo 消费的报价字段子集：腾讯快照（qt.gtimg.cn）与东财 ulist 都归一化成
 * 这一组字段，因此基础信息取数可以按 quotePriority 在两者间无缝切换。
 */
export interface MinuteBasicQuoteFields {
  /** 今开 */
  open: number | null
  /** 最高 */
  high: number | null
  /** 最低 */
  low: number | null
  /** 昨收 */
  previousClose: number | null
  /** 成交量（当日累计） */
  volume: number | null
}

export interface MinuteQuoteInfo {
  /** 今开 */
  open: number | null
  /** 最高 */
  high: number | null
  /** 最低 */
  low: number | null
  /**
   * 涨跌幅基准（昨收 / 昨结算）：非期货 = 昨收；期货（SHFE/COMEX 等）=
   * 昨结算（与卡片展示口径一致，见 api/market.ts resolveMetal）。
   * 分时页的价格、涨跌幅、图表 0% 线均以此为准。
   */
  preClose: number | null
  /** 基准价名称（昨收 / 昨结算），展示在基本信息卡该行 */
  preCloseLabel: '昨收' | '昨结算'
  /** 成交量（当日累计；报价 f5 优先，否则逐分钟量求和） */
  volume: number
  /** 是否有成交量（>0；外汇等无成交量标的隐藏该格子） */
  hasVolume: boolean
}

/**
 * 合并「东财 ulist 报价」与「分时推算值」得到基础信息：
 * - 今开/最高/最低：报价字段为正才采用，否则回退分时推算
 *   （闭市/上游缺失时报价字段可能为 0 或空）；
 * - 涨跌幅基准：期货（preSettlement > 0）直接用昨结算——期货「昨收」是昨日最后成交价，
 *   与涨跌幅口径（昨结算）不符，报价 f18（昨收）**不能**覆盖结算基准；
 *   非期货按 报价昨收 → 分时推算昨收 回退；
 * - 成交量：报价 f5 为正时优先，否则回退逐分钟量求和（外汇 f5=0 且分钟量也=0 → 0）；
 * - 均价不在报价中（f145 实测恒 0），仍由调用方取分时末点均价（trends2 f58）。
 */
export function mergeMinuteQuoteInfo(
  points: MinutePoint[],
  result: Pick<MinuteResult, 'preClose' | 'preSettlement'>,
  quote: MinuteBasicQuoteFields | null,
): MinuteQuoteInfo {
  const prices = points.map((p) => p.price).filter((v): v is number => Number.isFinite(v))
  const derivedOpen = points[0] && Number.isFinite(points[0].price) ? points[0].price : null
  const derivedHigh = prices.length ? Math.max(...prices) : null
  const derivedLow = prices.length ? Math.min(...prices) : null
  const derivedVolume = points.reduce((sum, p) => sum + (p.volume || 0), 0)
  const positive = (value: number | null | undefined, fallback: number | null): number | null =>
    typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback
  const quoteVolume =
    typeof quote?.volume === 'number' && Number.isFinite(quote.volume) ? quote.volume : null
  const volume = quoteVolume !== null && quoteVolume > 0 ? quoteVolume : derivedVolume
  // 涨跌幅基准：期货昨结算优先（沪主连等 昨收≠昨结算，报价 f18 为昨收不可覆盖结算基准）；
  // 但东财对非期货（现货贵金属 XAUUSD/XAGUSD、外汇、美元指数等）也冗余返回 preSettlement 字段
  // 且恒等于 preClose——此时不是结算价，按昨收处理（标签「昨收」），避免现货被误标「昨结算」。
  const isSettlementBase =
    result.preSettlement !== null &&
    result.preSettlement !== undefined &&
    Number.isFinite(result.preSettlement) &&
    (result.preSettlement as number) > 0 &&
    result.preSettlement !== result.preClose
  const preClose = isSettlementBase
    ? (result.preSettlement as number)
    : positive(quote?.previousClose, result.preClose)
  return {
    open: positive(quote?.open, derivedOpen),
    high: positive(quote?.high, derivedHigh),
    low: positive(quote?.low, derivedLow),
    preClose,
    preCloseLabel: isSettlementBase ? '昨结算' : '昨收',
    volume,
    hasVolume: volume > 0,
  }
}

// ---------------------------------------------------------------------------
// 源级失败熔断（按 code + 源种类；避免必失败的源在 8s 轮询里反复白打请求）
// ---------------------------------------------------------------------------

/** 熔断时长：5 分钟。到期自动重试，因此上游恢复后最迟 5 分钟即自动回到首选源 */
const BREAKER_TTL = 5 * 60 * 1000
/** key = `${code}|${kind}` → 最近一次失败时间戳 */
const sourceBreaker = new Map<string, number>()

function breakerKey(code: string, kind: string): string {
  return `${code}|${kind}`
}

function isBreakerOpen(code: string, kind: string, now = Date.now()): boolean {
  const at = sourceBreaker.get(breakerKey(code, kind))
  if (at === undefined) return false
  if (now - at >= BREAKER_TTL) {
    sourceBreaker.delete(breakerKey(code, kind))
    return false
  }
  return true
}

function markSourceFailed(code: string, kind: string, now = Date.now()): void {
  sourceBreaker.set(breakerKey(code, kind), now)
}

function markSourceOk(code: string, kind: string): void {
  sourceBreaker.delete(breakerKey(code, kind))
}

/** 清空熔断记录（测试 / 用户主动下拉刷新强制重试全部源时调用） */
export function resetMinuteSourceBreaker(): void {
  sourceBreaker.clear()
}

/**
 * 按 config/minute.ts 的每 code 优先级**从前到后**尝试：命中即返回，失败自动切下一个。
 * 代理股合成源（emProxies）与交叉汇率合成（emCross）同为计划中的一步，失败继续尝试后续源。
 * 全部源失败或该 code 无任何源时返回 null（调用方展示错误 / 重试）。
 */
export async function fetchMinuteData(code: string): Promise<MinuteFetchResult | null> {
  const plan = resolveMinutePlan(code)
  if (!plan.steps.length) return null
  // 时段（决定下面的网格裁剪）：A股固定 09:30-15:00，其余锚定首点
  const session = resolveMinuteSession(code)

  for (const step of plan.steps) {
    // 熔断中的源直接跳过（记 debug 便于排查「为什么没走腾讯」）
    if (isBreakerOpen(code, step.kind)) {
      console.debug(`[minute] ${code} 跳过熔断中的源 ${step.kind}`)
      continue
    }
    const hit = await runPlanStep(step, session, plan.note)
    if (hit) {
      markSourceOk(code, step.kind)
      return hit
    }
    markSourceFailed(code, step.kind)
  }
  return null
}

/**
 * 裁掉落在交易时段网格之外的分钟点。
 *
 * 起因：腾讯 A股个股分时在 15:00 之后还挂着 15:06–15:30 的盘后固定价格交易段（实测贵州茅台
 * 共 25 个点，价格恒为收盘价），东财只到 15:00。若不裁，quote-chart / 分享海报的铺格逻辑
 * （draw.ts buildPadded：任一分钟落到网格外即整条序列回退「拉伸绘制」）会让 A股的午休留白与
 * 真实时段轴全部失效，图被压成一条到尾的均分曲线。
 *
 * 时间格式不可解析（理论上合成源为完整时间戳）时原样保留，绝不因裁剪丢数据。
 */
export function trimToMinuteGrid(points: MinutePoint[], session: MinuteSessionKind): MinutePoint[] {
  if (session === 'continuous' || !points.length) return points
  const anchor = parseMinuteOfDay(points[0]?.time ?? '')
  if (anchor === null) return points
  const grid = buildMinuteGrid(session, anchor)
  if (!grid) return points
  const kept: MinutePoint[] = []
  let dropped = false
  for (const point of points) {
    const minute = parseMinuteOfDay(point.time)
    if (minute !== null && minuteToSlot(grid, minute) === null) {
      dropped = true
      continue
    }
    kept.push(point)
  }
  return dropped ? kept : points
}

/** 执行计划中的一步；失败（异常 / 空数据 / 有效点数不足）返回 null */
async function runPlanStep(
  step: MinutePlanStep,
  session: MinuteSessionKind,
  note?: string,
): Promise<MinuteFetchResult | null> {
  try {
    if (step.kind === 'emProxies') {
      const composite = await fetchCompositeMinute(step.proxies ?? [])
      if (!composite) return null
      const points = trimToMinuteGrid(composite.result.points, session)
      if (points.length < MIN_MINUTE_POINTS) return null
      return {
        ...composite.result,
        points,
        source: KIND_TO_SOURCE.emProxies,
        sourceLabel: COMPOSITE_SOURCE_LABEL,
        note: composite.note,
      }
    }
    if (step.kind === 'emCross') {
      if (!step.cross) return null
      const cross = await fetchCrossMinute(step.cross)
      if (!cross) return null
      const points = trimToMinuteGrid(cross.points, session)
      if (points.length < MIN_MINUTE_POINTS) return null
      return {
        ...cross,
        points,
        source: KIND_TO_SOURCE.emCross,
        sourceLabel: CROSS_SOURCE_LABEL,
        note,
      }
    }

    const result =
      step.kind === 'tencent'
        ? step.tc
          ? await minuteApi.tencent(step.tc)
          : null
        : step.kind === 'eastmoney'
          ? step.secid
            ? await minuteApi.eastmoney(step.secid)
            : null
          : step.symbol
            ? await minuteApi.yahoo(step.symbol)
            : null
    // 点数过少视为无效（腾讯境外股只返回收盘 1 点、空数据等），继续下一源
    if (!result || result.points.length < MIN_MINUTE_POINTS) return null
    const points = trimToMinuteGrid(result.points, session)
    if (points.length < MIN_MINUTE_POINTS) return null
    const source = KIND_TO_SOURCE[step.kind]
    return { ...result, points, source, sourceLabel: SOURCE_LABELS[source], note }
  } catch (error) {
    console.warn(`[minute] 分时源 ${step.kind} 执行失败（${codeOf(step)}）:`, error)
    return null
  }
}

/** 计划步骤的可读标识（日志用） */
function codeOf(step: MinutePlanStep): string {
  return step.tc ?? step.secid ?? step.symbol ?? step.cross?.numerator ?? step.proxies?.[0] ?? '-'
}

// ---------------------------------------------------------------------------
// 基础信息报价（今开 / 最高 / 最低 / 昨收 / 成交量）多源
// 优先级由 config/minute.ts 的 quotePriority 决定，缺省「腾讯快照 → 东财 ulist」。
// ---------------------------------------------------------------------------

/** 归一化的基础信息报价（腾讯快照与东财 ulist 的同构视图，供 mergeMinuteQuoteInfo 消费） */
export interface MinuteBasicQuote extends MinuteBasicQuoteFields {
  /** 命中的源：腾讯快照 / 东财 ulist */
  source: 'tencent' | 'eastmoney'
  sourceLabel: string
}

const BASIC_QUOTE_LABELS: Record<MinuteBasicQuote['source'], string> = {
  tencent: '腾讯行情',
  eastmoney: '东方财富行情',
}

/**
 * 依次尝试 quotePriority 中的源，返回第一个有效报价（全部失败返回 null，
 * 调用方回退分时推算值）。腾讯快照与东财 ulist 都返回同一组字段，故对上层完全同构。
 */
export async function fetchMinuteBasicQuote(code: string): Promise<MinuteBasicQuote | null> {
  const steps = resolveMinuteQuotePlan(code)
  for (const step of steps) {
    if (isBreakerOpen(code, `quote:${step.kind}`)) continue
    let quote: MinuteBasicQuote | null = null
    try {
      quote =
        step.kind === 'tencent'
          ? step.tc
            ? basicQuoteOfTencent(await fetchTencentQuote(step.tc))
            : null
          : step.secid
            ? basicQuoteOfEastmoney(await fetchEastmoneyUlistQuote(step.secid))
            : null
    } catch (error) {
      console.warn(`[minute] 基础信息报价源 ${step.kind} 失败（${code}）:`, error)
      quote = null
    }
    if (quote) {
      markSourceOk(code, `quote:${step.kind}`)
      return quote
    }
    markSourceFailed(code, `quote:${step.kind}`)
  }
  return null
}

/** 腾讯快照 → 基础信息（字段已由 tencentQuoteOf 按实测索引归一化） */
function basicQuoteOfTencent(quote: TencentQuote | null): MinuteBasicQuote | null {
  if (!quote || !quote.valid || quote.latestPrice === null || quote.latestPrice <= 0) return null
  return {
    open: quote.open,
    high: quote.high,
    low: quote.low,
    previousClose: quote.previousClose,
    volume: quote.volume,
    source: 'tencent',
    sourceLabel: BASIC_QUOTE_LABELS.tencent,
  }
}

/** 东财 ulist → 基础信息 */
function basicQuoteOfEastmoney(quote: EastmoneyUlistQuote | null): MinuteBasicQuote | null {
  if (!quote || quote.price === null || quote.price <= 0) return null
  return {
    open: quote.open,
    high: quote.high,
    low: quote.low,
    previousClose: quote.previousClose,
    volume: quote.volume,
    source: 'eastmoney',
    sourceLabel: BASIC_QUOTE_LABELS.eastmoney,
  }
}

// ---------------------------------------------------------------------------
// 美股代理股分时均值合成
// ---------------------------------------------------------------------------

interface CompositeMinuteData {
  result: MinuteResult
  /** 标注文案（含代理股中文名） */
  note: string
}

/**
 * 并发拉取每只代理股分时（保留完整时间戳），归一化到昨收 100 后合成均值。
 * 单只代理失败/点数不足自动跳过（部分可用即合成），全部失败返回 null。
 */
async function fetchCompositeMinute(secids: string[]): Promise<CompositeMinuteData | null> {
  const results = await Promise.all(
    secids.map((secid) => minuteApi.eastmoney(secid, { keepFullTime: true })),
  )
  const valid: Array<{
    secid: string
    name?: string
    preClose: number
    series: CompositeSeries['points']
  }> = []
  secids.forEach((secid, index) => {
    const result = results[index]
    if (
      !result ||
      result.points.length < MIN_MINUTE_POINTS ||
      !result.preClose ||
      result.preClose <= 0
    ) {
      return
    }
    valid.push({
      secid,
      name: result.name,
      preClose: result.preClose,
      series: result.points.map((p) => ({
        time: p.time,
        norm: (p.price / (result.preClose as number)) * 100,
        volume: p.volume || 0,
      })),
    })
  })
  if (!valid.length) return null

  const points = buildCompositePoints(
    valid.map((item) => ({ name: item.name, points: item.series })),
  )
  if (points.length < MIN_MINUTE_POINTS) return null

  return {
    result: { preClose: 100, points },
    note: buildCompositeNote(
      valid.map((item) => ({ ticker: bareCode(item.secid), name: item.name })),
    ),
  }
}

/**
 * 合成图标注文案：列出代理股中文名（中文名表优先，东财名兜底），最多列 4 只，
 * 其余以「等 N 只」概括；单只代理（板块 ETF）直接标注该标的。
 */
function buildCompositeNote(proxies: Array<{ ticker: string; name?: string }>): string {
  const shown = proxies.slice(0, 4)
  const head = shown.map((p) => `${proxyDisplayName(p.ticker, p.name)}(${p.ticker})`).join('、')
  if (proxies.length === 1) {
    return `由 ${head} 当日分时均值合成（基准=昨收100，与卡片口径一致）`
  }
  const tail = proxies.length > shown.length ? `等${proxies.length}只` : ''
  return `由 ${head}${tail}美股代理股当日分时均值合成（基准=昨收100，与卡片口径一致）`
}

/** 代理股展示名：中文名表优先（保证中文名），东财中文名兜底，再退回代码 */
function proxyDisplayName(ticker: string, apiName?: string): string {
  const manual = US_PROXY_NAMES[ticker]
  if (manual) return manual
  if (apiName && /[\u4e00-\u9fff]/.test(apiName)) return apiName
  return ticker
}

export type { MinuteSources }

/**
 * 交叉汇率分时合成：并发拉取两腿东财 trends2（keepFullTime 完整时间戳），
 * 分子 ÷ 分母 逐分钟相除；昨收 = 两腿昨收相除（与首点大致衔接）。
 * 任一条腿失败/点数不足返回 null（由调用方展示错误/重试）。
 */
async function fetchCrossMinute(cross: {
  numerator: string
  denominator: string
}): Promise<MinuteResult | null> {
  const [num, den] = await Promise.all([
    minuteApi.eastmoney(cross.numerator, { keepFullTime: true }),
    minuteApi.eastmoney(cross.denominator, { keepFullTime: true }),
  ])
  if (!num || !den) return null
  const points = buildCrossPoints(
    { points: num.points.map((p) => ({ time: p.time, price: p.price })) },
    { points: den.points.map((p) => ({ time: p.time, price: p.price })) },
  )
  if (points.length < MIN_MINUTE_POINTS) return null
  const preClose =
    num.preClose !== null &&
    Number.isFinite(num.preClose) &&
    den.preClose !== null &&
    Number.isFinite(den.preClose) &&
    den.preClose !== 0
      ? num.preClose / den.preClose
      : null
  return { preClose, points }
}

export type MinuteVolumeDirection = 'up' | 'down' | 'flat'

/**
 * 计算分时图每分钟成交量柱的涨跌方向（用于分色）：
 * - 红柱 ('up')：该分钟最后一笔成交价 > 该分钟开盘价（即该分钟股价收涨）
 * - 绿柱 ('down')：该分钟最后一笔成交价 < 该分钟开盘价（即该分钟股价收跌）
 * - 白/灰柱 ('flat')：该分钟收盘价 = 开盘价（价格持平）
 *
 * 注：
 * - i = 0（首点）：若有昨收 preClose（>0），以昨收作为开盘基准比对；若无昨收，作为持平 'flat'
 * - i > 0：以上一分钟最后一笔成交价作为该分钟开盘价进行对比
 */
export function computeMinuteVolumeDirections(
  points: Array<{ price: number }>,
  preClose?: number | null,
): MinuteVolumeDirection[] {
  const n = points.length
  const result = new Array<MinuteVolumeDirection>(n)
  const hasPre = typeof preClose === 'number' && Number.isFinite(preClose) && preClose > 0
  for (let i = 0; i < n; i += 1) {
    const curP = points[i]?.price ?? 0
    if (i === 0) {
      if (!hasPre) {
        result[i] = 'flat'
      } else {
        const pre = preClose as number
        if (curP > pre) result[i] = 'up'
        else if (curP < pre) result[i] = 'down'
        else result[i] = 'flat'
      }
    } else {
      const prevP = points[i - 1]?.price ?? 0
      if (curP > prevP) {
        result[i] = 'up'
      } else if (curP < prevP) {
        result[i] = 'down'
      } else {
        result[i] = 'flat'
      }
    }
  }
  return result
}
