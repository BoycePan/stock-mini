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
  trends?: string[]
}

/**
 * 解析东财 trends2 响应。
 * 每行（fields2=f51..f58）：[0]时间 [1]现价 [5]成交量 [6]成交额 [7]均价
 */
export function parseEastmoneyTrends(data?: EastmoneyTrendsData): MinuteResult | null {
  const rows = data?.trends
  if (!rows?.length) return null
  const points: MinutePoint[] = []
  for (const row of rows) {
    const f = row.split(',')
    const price = Number(f[1])
    if (f.length < 8 || !Number.isFinite(price)) continue
    const volume = Number(f[5])
    const amount = Number(f[6])
    const avg = Number(f[7])
    points.push({
      time: shortTime(f[0] ?? ''),
      price,
      avg: Number.isFinite(avg) ? avg : null,
      volume: Number.isFinite(volume) ? volume : 0,
      amount: Number.isFinite(amount) ? amount : undefined,
    })
  }
  if (points.length < MIN_MINUTE_POINTS) return null
  const preClose = data?.preClose
  return { preClose: Number.isFinite(preClose) ? (preClose as number) : null, points }
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
