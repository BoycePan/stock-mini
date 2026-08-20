/**
 * 当日分时响应解析纯函数（可单测，不依赖 wx 运行时）。
 *
 * 三个源归一化为 MinuteResult：{ preClose, points: MinutePoint[] }，
 * points 时间升序；均价缺失时按 累计成交额/累计成交量 推算。
 */

import type { MinutePoint, MinuteResult } from '../types/stock'

/** 少于该点数的分时数据视为无效（避免腾讯外股单点/空数据误判为命中） */
export const MIN_MINUTE_POINTS = 2

// ---------------------------------------------------------------------------
// 东财分时（trends2）
// ---------------------------------------------------------------------------

interface EastmoneyTrendsData {
  preClose?: number
  name?: string
  trends?: string[]
}

/**
 * 解析东财 trends2 响应。
 * 每行（fields2=f51..f58）：[0]时间 [1]现价 [5]成交量 [6]成交额 [7]均价
 * @param opts.keepFullTime 保留完整时间戳（"YYYY-MM-DD HH:mm"，字典序即时间序，
 *   用于美股代理股合成时的跨零点时间对齐）；默认输出短时间 HH:mm
 */
export function parseEastmoneyTrends(
  data?: EastmoneyTrendsData,
  opts?: { keepFullTime?: boolean },
): MinuteResult | null {
  const rows = data?.trends
  if (!rows?.length) return null
  const keepFull = opts?.keepFullTime === true
  const points: MinutePoint[] = []
  for (const row of rows) {
    const f = row.split(',')
    const price = Number(f[1])
    // 价格为 0 / 空字段（Number('')=0）视为该分钟无成交，跳过：
    // 外汇等 24h 标的个别分钟可能无成交，0 价会污染价格线与纵轴（|0-昨收| 撑爆刻度）
    if (f.length < 8 || !Number.isFinite(price) || price <= 0) continue
    const volume = Number(f[5])
    const amount = Number(f[6])
    const avg = Number(f[7])
    points.push({
      time: keepFull ? (f[0] ?? '') : shortTime(f[0] ?? ''),
      price,
      // 均价 > 0 才有效：东财对无成交分钟（如外汇成交量恒 0）返回 0.00000，
      // 0 均价没有意义（真实均价必为正），置 null 避免污染纵轴与均价线
      avg: avg > 0 ? avg : null,
      volume: Number.isFinite(volume) ? volume : 0,
      amount: Number.isFinite(amount) ? amount : undefined,
    })
  }
  if (points.length < MIN_MINUTE_POINTS) return null
  const preClose = data?.preClose
  return {
    preClose: Number.isFinite(preClose) ? (preClose as number) : null,
    points,
    ...(data?.name ? { name: data.name } : {}),
  }
}

// ---------------------------------------------------------------------------
// 腾讯分时（minute/query）
// ---------------------------------------------------------------------------

interface TencentMinuteNode {
  data?: { data?: string[][] }
  qt?: Record<string, unknown[]>
}

/**
 * 解析腾讯分时响应节点。
 * 每行 ["0930","现价","成交量","成交额"]；均价按 累计成交额/累计成交量 推算；
 * 昨收取 qt.<code>[4]（腾讯报价数组索引）。
 */
export function parseTencentMinuteNode(node?: TencentMinuteNode): MinuteResult | null {
  const rows = node?.data?.data
  if (!rows?.length) return null

  const points: MinutePoint[] = []
  let cumVolume = 0
  let cumAmount = 0
  for (const row of rows) {
    const time = row[0] ?? ''
    const price = Number(row[1])
    const volume = Number(row[2])
    const amount = Number(row[3])
    if (!time || !Number.isFinite(price)) continue
    cumVolume += Number.isFinite(volume) ? volume : 0
    cumAmount += Number.isFinite(amount) ? amount : 0
    points.push({
      time: shortTime(time),
      price,
      avg: cumVolume > 0 ? cumAmount / cumVolume : null,
      volume: Number.isFinite(volume) ? volume : 0,
      amount: Number.isFinite(amount) ? amount : undefined,
    })
  }
  if (points.length < MIN_MINUTE_POINTS) return null

  // 腾讯 qt.<code> 为报价数组：[4] = 昨收
  let preClose: number | null = null
  for (const values of Object.values(node?.qt ?? {})) {
    if (!Array.isArray(values)) continue
    const v = Number(values[4])
    if (Number.isFinite(v) && v > 0) {
      preClose = v
      break
    }
  }
  return { preClose, points }
}

// ---------------------------------------------------------------------------
// Yahoo 1分钟线（chart v8）
// ---------------------------------------------------------------------------

interface YahooChartResult {
  meta?: { chartPreviousClose?: number }
  timestamp?: number[]
  indicators?: {
    quote?: Array<
      Partial<Record<'open' | 'high' | 'low' | 'close' | 'volume', Array<number | null>>>
    >
  }
}

/**
 * 解析 Yahoo 1分钟 chart result。
 * 均价按 1分钟成交额（价×量）累计 / 成交量累计 推算；昨收取 meta.chartPreviousClose。
 */
export function parseYahooMinuteResult(result?: YahooChartResult): MinuteResult | null {
  const timestamps = result?.timestamp
  const quote = result?.indicators?.quote?.[0]
  if (!timestamps?.length || !quote) return null

  const closes = quote.close ?? []
  const volumes = quote.volume ?? []

  const points: MinutePoint[] = []
  let cumVolume = 0
  let cumAmount = 0
  for (let i = 0; i < timestamps.length; i += 1) {
    const ts = timestamps[i]
    const close = closes[i]
    if (typeof ts !== 'number' || typeof close !== 'number' || !Number.isFinite(close)) continue
    const volume =
      typeof volumes[i] === 'number' && Number.isFinite(volumes[i]) ? (volumes[i] as number) : 0
    cumVolume += volume
    cumAmount += close * volume
    points.push({
      time: shortTime(formatMinuteTime(ts)),
      price: close,
      avg: cumVolume > 0 ? cumAmount / cumVolume : null,
      volume,
    })
  }
  if (points.length < MIN_MINUTE_POINTS) return null

  const preClose = result?.meta?.chartPreviousClose
  return {
    preClose: typeof preClose === 'number' && Number.isFinite(preClose) ? preClose : null,
    points,
  }
}

/** epoch 秒 → "YYYY-MM-DD HH:mm"（本地时区） */
function formatMinuteTime(epochSeconds: number): string {
  const d = new Date(epochSeconds * 1000)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return `${y}-${m}-${day} ${hh}:${mm}`
}

/**
 * 时间显示统一为 HH:mm：
 * - "2026-08-19 09:30" / "2026-08-19 09:30:00" → "09:30"
 * - "0930"（腾讯）→ "09:30"
 */
export function shortTime(time: string): string {
  if (!time) return time
  // ISO 风格 "YYYY-MM-DD HH:mm(:ss)"
  const iso = /^\d{4}-\d{2}-\d{2}[ T](\d{2}:\d{2})/.exec(time)
  if (iso) return iso[1] ?? time
  // 腾讯风格 "HHmm"
  if (/^\d{4}$/.test(time)) {
    return `${time.slice(0, 2)}:${time.slice(2)}`
  }
  return time
}

// ---------------------------------------------------------------------------
// 美股代理股分时均值合成（美股时段行业板块）
// ---------------------------------------------------------------------------

/** 单只代理股归一化到昨收 100 后的分时序列（供合成） */
export interface CompositeSeries {
  /** 代理股名（东财返回，可能为英文） */
  name?: string
  points: Array<{
    /** 完整时间戳（"YYYY-MM-DD HH:mm"，字典序即时间序，支持跨零点美股时段） */
    time: string
    /** 归一价：price / preClose * 100（昨收=100） */
    norm: number
    volume: number
  }>
}

/**
 * 多只代理股分时均值合成：
 * - 时间并集（ISO 完整时间戳字典序即时间序，覆盖美股时段跨零点 21:30 → 04:00）；
 * - 每个时间点对「该分钟有数据的代理」取 norm 均值（个别代理缺分钟/失败时自动跳过）；
 * - 成交量取各代理之和；合成序列无均价口径（avg=null）。
 * 输出 points 时间升序、time 为 HH:mm，供分钟页直接渲染。
 */
export function buildCompositePoints(series: CompositeSeries[]): MinutePoint[] {
  if (!series.length) return []
  const byTime = new Map<string, { sum: number; count: number; volume: number }>()
  for (const item of series) {
    for (const p of item.points) {
      const agg = byTime.get(p.time)
      if (agg) {
        agg.sum += p.norm
        agg.count += 1
        agg.volume += p.volume
      } else {
        byTime.set(p.time, { sum: p.norm, count: 1, volume: p.volume })
      }
    }
  }
  const times = Array.from(byTime.keys()).sort()
  return times.map((time) => {
    const agg = byTime.get(time) as { sum: number; count: number; volume: number }
    return { time: shortTime(time), price: agg.sum / agg.count, avg: null, volume: agg.volume }
  })
}

// ---------------------------------------------------------------------------
// 交叉汇率合成（人民币/韩元等东财无直盘货币对）
// ---------------------------------------------------------------------------

/** 交叉汇率一条腿的分时序列（东财 keepFullTime 保留完整时间戳） */
export interface CrossLegSeries {
  points: Array<{
    /** 完整时间戳（"YYYY-MM-DD HH:mm"，字典序即时间序） */
    time: string
    /** 现价 */
    price: number
  }>
}

/**
 * 交叉汇率合成：numerator / denominator 逐分钟相除。
 * - 以分子（如 美元/韩元）的时间序列为主，分母（如 美元/离岸人民币）缺分钟时跳过该点；
 * - 输出 price 按 4 位小数取整（外汇常见精度），无成交量/均价口径（volume=0、avg=null）；
 * - 输出 time 为 HH:mm，序列保持升序（分子已按时间升序输入）。
 */
export function buildCrossPoints(
  numerator: CrossLegSeries,
  denominator: CrossLegSeries,
): MinutePoint[] {
  if (!numerator.points.length || !denominator.points.length) return []
  const denByTime = new Map<string, number>()
  for (const p of denominator.points) {
    denByTime.set(p.time, p.price)
  }
  const points: MinutePoint[] = []
  for (const p of numerator.points) {
    const den = denByTime.get(p.time)
    if (den === undefined || !Number.isFinite(den) || den === 0) continue
    const price = p.price / den
    if (!Number.isFinite(price)) continue
    points.push({
      time: shortTime(p.time),
      // 四舍五入到 4 位小数，避免浮点噪声（如 1392.8/6.7225=207.1863…）
      price: Math.round(price * 10000) / 10000,
      avg: null,
      volume: 0,
    })
  }
  return points
}
