/**
 * 当日分时多源兜底链（东财 → 腾讯 → Yahoo），与首页行情「新浪 → 腾讯 → 东财」同思路。
 * 页面层只依赖本模块：传入首页卡片 code，返回归一化的分时数据与命中的源。
 *
 * 美股时段行业板块（us-BKxxxx）：走「代理股分时均值合成」——
 * 卡片展示的正是美股代理股涨跌幅均值，分时同样对每只代理取东财 trends2
 * （归一化到昨收 100）后逐分钟取均值（跨零点对齐，基准=昨收100），口径完全一致；
 * 标注文案中代理股给出中文名（东财名，英文名用 US_PROXY_NAMES 补充表）。
 */

import type { MinutePoint, MinuteResult } from '../types/stock'
import type { EastmoneyUlistQuote } from '../types/quote'
import { minuteApi } from '../api/minute'
import { fiveDayApi } from '../api/five-day'
import {
  ashareTcCode,
  US_PROXY_NAMES,
  resolveMinuteSources,
  type MinuteSources,
} from '../config/minute'
import {
  buildMinuteGrid,
  minuteToSlot,
  parseMinuteOfDay,
  resolveMinuteSession,
  type MinuteSessionKind,
} from './minute-session'
import { countPointDays } from './five-day-parser'
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
  quote: EastmoneyUlistQuote | null,
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

/**
 * 依次尝试 东财 → 腾讯 → Yahoo 拉取当日分时，命中即返回。
 * 代理股合成源（emProxies）为独立分支：全部代理失败返回 null（由调用方展示错误/重试）。
 * 全部失败或该 code 无任何源时返回 null。
 * @param opts.ndays 1 = 当日分时（默认）；2..5 = 多日分时（仅东财 push2 节点可能支持）。
 *   多日模式下不尝试 tc / yahoo 兜底源（它们只有当日数据，混用会得到「只有 1 天」的假五日）。
 * @param opts.host 东财节点：delay（默认，当日分时）/ push2（多日分时）
 */
export async function fetchMinuteData(
  code: string,
  opts?: { ndays?: number; host?: 'delay' | 'push2' },
): Promise<MinuteFetchResult | null> {
  const sources = resolveMinuteSources(code)
  if (!sources) return null
  const days = opts?.ndays && opts.ndays > 1 ? Math.min(5, Math.floor(opts.ndays)) : 1
  const host = opts?.host ?? 'delay'

  // 美股代理股分时均值合成（us-BKxxxx）
  if (sources.emProxies?.length) {
    const composite = await fetchCompositeMinute(sources.emProxies, days, host)
    if (!composite) return null
    return {
      ...composite.result,
      source: 'em',
      sourceLabel: COMPOSITE_SOURCE_LABEL,
      note: composite.note,
    }
  }

  // 交叉汇率合成（如 CNYKRW = 美元/韩元 ÷ 美元/离岸人民币，东财 119/133 大陆可访问）
  if (sources.emCross) {
    const cross = await fetchCrossMinute(sources.emCross, days, host)
    if (!cross) return null
    return {
      ...cross,
      source: 'em',
      sourceLabel: CROSS_SOURCE_LABEL,
      note: sources.note,
    }
  }

  const tries: Array<{ key: 'em' | 'tc' | 'yahoo'; run: () => Promise<MinuteResult | null> }> = []
  if (sources.em) {
    tries.push({
      key: 'em',
      run: () => minuteApi.eastmoney(sources.em as string, { ndays: days, host }),
    })
  }
  if (days === 1) {
    if (sources.tc) {
      tries.push({ key: 'tc', run: () => minuteApi.tencent(sources.tc as string) })
    }
    if (sources.yahoo) {
      tries.push({ key: 'yahoo', run: () => minuteApi.yahoo(sources.yahoo as string) })
    }
  }

  for (const { key, run } of tries) {
    const result = await run()
    // 点数过少视为无效（腾讯外股/空数据），继续下一源
    if (result && result.points.length >= MIN_MINUTE_POINTS) {
      return { ...result, source: key, sourceLabel: SOURCE_LABELS[key], note: sources.note }
    }
  }
  return null
}

/**
 * 该标的是否可能支持「五日」分时（多日分钟线）。
 * 三条路径任一可推导即视为可用：东财 secid（含代理/交叉合成腿）、腾讯 A股与港股 / A股指数代码、A股 5 分钟 K 线。
 */
export function hasFiveDaySource(code: string): boolean {
  const sources = resolveMinuteSources(code)
  if (!sources) return false
  if (sources.em || sources.emProxies?.length || sources.emCross) return true
  return !!fiveDayTencentCode(code)
}

/**
 * 五日兜底链（东财延迟节点会忽略 ndays，故必须逐级校验「是否真的跨日」）：
 *   1. 东财 push2 节点的 trends2 `ndays=5`（覆盖最广：A股 / 美股 / 日韩 / 期货 / 外汇 / 板块 / 代理合成）；
 *   2. 腾讯 `appstock/app/day/query`（A股 / 港股 / A股指数，实测 5 个交易日 × 1 分钟）；
 *   3. 新浪 A股 5 分钟 K 线（240 根 ≈ 5 个交易日）。
 * 均不命中返回 null（页面展示「该周期暂无数据」，五日 TAB 仍可切换）。
 */
export async function fetchFiveDayData(code: string): Promise<MinuteFetchResult | null> {
  if (!hasFiveDaySource(code)) return null

  // 1) 东财 push2 多日分时
  const em = await fetchMinuteData(code, { ndays: 5, host: 'push2' })
  if (em && countPointDays(em.points) >= 2) {
    return { ...em, sourceLabel: '东方财富五日分时', note: em.note }
  }

  // 2) 腾讯五日（A股 / 港股 / A股指数）
  const tcCode = fiveDayTencentCode(code)
  if (tcCode) {
    const tencent = await fiveDayApi.tencent(tcCode)
    if (tencent && tencent.points.length >= MIN_MINUTE_POINTS) {
      const points = filterToSession(tencent.points, resolveMinuteSession(code))
      if (points.length >= MIN_MINUTE_POINTS) {
        return {
          preClose: tencent.preClose,
          points,
          source: 'tc',
          sourceLabel: '腾讯五日分时',
          note: '腾讯五日：最近 5 个交易日 1 分钟数据（以区间首点为 0% 基准）',
        }
      }
    }
  }

  // 3) 新浪 A股 5 分钟 K 线
  const sinaCode = fiveDaySinaCode(code)
  if (sinaCode) {
    const sina = await fiveDayApi.sina(sinaCode)
    if (sina && sina.points.length >= MIN_MINUTE_POINTS) {
      const points = filterToSession(sina.points, resolveMinuteSession(code))
      if (points.length >= MIN_MINUTE_POINTS) {
        return {
          preClose: sina.preClose,
          points,
          source: 'tc',
          sourceLabel: '新浪五日（5分钟）',
          note: '新浪五日：最近 5 个交易日 5 分钟数据（以区间首点为 0% 基准）',
        }
      }
    }
  }
  return null
}

/**
 * 五日数据源代码推导：
 * - A股 / 港股 / A股指数：腾讯 day/query 的行情代码（sh600519 / hk00700 / sh000001）；
 * - 东财 secid（1.600519 / 0.000001）还原成腾讯代码；
 * - 其余（美股 / 日韩 / 期货 / 外汇 / 板块）返回空串：腾讯五日不支持，走东财 push2 或降级。
 */
export function fiveDayTencentCode(code: string): string {
  if (/^(sh|sz|bj)\d{6}$/.test(code)) return code
  if (/^hk\d{5}$/.test(code)) return code
  if (/^[01]\.\d{6}$/.test(code)) return ashareTcCode(code.slice(2))
  return ''
}

/** 新浪 5 分钟 K 线代码：仅 A股 / A股指数（sh / sz / bj 前缀） */
export function fiveDaySinaCode(code: string): string {
  if (/^(sh|sz|bj)\d{6}$/.test(code)) return code
  if (/^[01]\.\d{6}$/.test(code)) return ashareTcCode(code.slice(2))
  return ''
}

/**
 * 只保留落在该标的正规交易时段内的分钟点：
 * 腾讯 day/query 每根含收盘后 15:01-15:30 的固定价（实测 267 行/日），
 * 若原样绘制会让五日线多出一段平尾；用既有交易时段模型过滤（无法对齐时段时原样返回）。
 */
export function filterToSession(points: MinutePoint[], session: MinuteSessionKind): MinutePoint[] {
  if (!points.length || !session || session === 'continuous') return points
  const anchor = parseMinuteOfDay(points[0]?.time ?? '')
  if (anchor === null) return points
  const grid = buildMinuteGrid(session, anchor)
  if (!grid) return points
  const kept = points.filter((point) => {
    const minute = parseMinuteOfDay(point.time)
    return minute !== null && minuteToSlot(grid, minute) !== null
  })
  return kept.length >= MIN_MINUTE_POINTS ? kept : points
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
 * @param days 1 = 当日；2..5 = 多日（五日 TAB，仅 push2 节点可能支持）
 */
async function fetchCompositeMinute(
  secids: string[],
  days = 1,
  host: 'delay' | 'push2' = 'delay',
): Promise<CompositeMinuteData | null> {
  const results = await Promise.all(
    secids.map((secid) => minuteApi.eastmoney(secid, { keepFullTime: true, ndays: days, host })),
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
 * @param days 1 = 当日；2..5 = 多日（五日 TAB，仅 push2 节点可能支持）
 */
async function fetchCrossMinute(
  cross: {
    numerator: string
    denominator: string
  },
  days = 1,
  host: 'delay' | 'push2' = 'delay',
): Promise<MinuteResult | null> {
  const [num, den] = await Promise.all([
    minuteApi.eastmoney(cross.numerator, { keepFullTime: true, ndays: days, host }),
    minuteApi.eastmoney(cross.denominator, { keepFullTime: true, ndays: days, host }),
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
