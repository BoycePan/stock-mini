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
  /** 昨结算（期货口径涨跌幅基准；非期货为 0 或缺失） */
  preSettlement?: number
  name?: string
  trends?: string[]
}

/**
 * 解析东财 trends2 响应。
 * 行按字段数自适应两种布局（现价均取 收盘/现价 f53）：
 * - 4 字段（fields2=f51,f53,f56,f58，生产请求）：[0]时间 [1]现价 [2]成交量 [3]均价
 * - 8 字段（fields2=f51..f58，兼容/兜底）：[0]时间 [1]开盘 [2]现价 [3]最高 [4]最低
 *   [5]成交量 [6]成交额 [7]均价 —— 现价在 f[2]，不要读 f[1]（那是开盘价）
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
    if (f.length < 4) continue
    const full = f.length >= 8
    // 现价位置随布局不同：4字段=f[1]（f53），8字段=f[2]（f[1] 是开盘价）
    const price = Number(full ? f[2] : f[1])
    // 价格为 0 / 空字段（Number('')=0）视为该分钟无成交，跳过：
    // 外汇等 24h 标的个别分钟可能无成交，0 价会污染价格线与纵轴（|0-昨收| 撑爆刻度）
    if (!Number.isFinite(price) || price <= 0) continue
    const volume = Number(full ? f[5] : f[2])
    const amount = full ? Number(f[6]) : undefined
    const avg = Number(full ? f[7] : f[3])
    points.push({
      time: keepFull ? (f[0] ?? '') : shortTime(f[0] ?? ''),
      // 东财行首即完整时间戳（"YYYY-MM-DD HH:mm"），触摸浮层展示「年月日 时分」需要它
      timeFull: fullTimeOf(f[0] ?? ''),
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
  // 昨结算透传（期货涨跌幅按昨结算计算，与昨收不同；非期货为 0/缺失 → null）
  const preSettlement =
    data?.preSettlement !== undefined &&
    Number.isFinite(data.preSettlement) &&
    (data.preSettlement as number) > 0
      ? (data.preSettlement as number)
      : null
  return {
    preClose: Number.isFinite(preClose) ? (preClose as number) : null,
    preSettlement,
    points,
    ...(data?.name ? { name: data.name } : {}),
  }
}

// ---------------------------------------------------------------------------
// 腾讯分时（minute/query）
// ---------------------------------------------------------------------------

interface TencentMinuteNode {
  /** 实测（2026-09-17）为字符串数组：["0930 1257.98 140 17611720.00", …]；兼容旧的二维数组形态 */
  data?: { data?: Array<string | string[]> }
  qt?: Record<string, unknown[]>
}

/**
 * 腾讯分时行 → 字段数组。
 * 实测行格式为**空格分隔的单字符串**：`"HHmm 现价 累计成交量 [累计成交额]"`；
 * 早期版本按二维数组（row[0]/row[1]…）解析，实际拿到的是字符串下标（row[0]='0'、row[1]='9'），
 * 会把「时间」解析成单个数字字符、把所有价格解析成个位数——因腾讯此前只是东财的兜底源，
 * 该缺陷一直未被触发；2026-09-17 把腾讯提为首选源后才暴露，这里按实测格式修正。
 */
function tencentRowFields(row: string | string[]): string[] {
  if (Array.isArray(row)) return row.map((item) => String(item ?? '').trim())
  return String(row ?? '')
    .trim()
    .split(/\s+/)
}

/**
 * 腾讯分时成交量单位换算：A股（sh/sz/bj，含指数）分时成交量单位为「手」，港股/美股/日韩为「股」。
 * 均价 = 累计成交额 ÷ (累计成交量 × 该系数)（A股 1 手 = 100 股，实测贵州茅台
 * 17611720.00 ÷ (140 × 100) = 1257.98 = 该分钟现价，与东财 f58 一致）。
 */
function tencentShareScale(code: string): number {
  return /^(sh|sz|bj)/i.test(code) ? 100 : 1
}

/**
 * 解析腾讯分时响应节点。
 *
 * 行格式（实测）：`"HHmm 现价 累计成交量 [累计成交额]"` —— 第 3/4 字段为**当日累计值**
 * （实测单调递增：贵州茅台 09:30 的 140 手 → 15:00 的 17554 手，与当日总量一致），
 * 而图表与基础信息消费的是**每分钟**增量，故这里做差分：
 *   volume(i) = cumVolume(i) − cumVolume(i−1)（首点 = cumVolume(0)，负值兜底 0）
 * 均价按累计额 ÷ 累计量（× 单位系数）推算，并做合理性护栏：与现价偏离 >50% 时置 null。
 * 护栏的必要性：A股指数（如上证指数）由「成交额 ÷ 成交量」反推得到的是全市场每股均价
 * （实测 19.18 vs 指数 3875.60），与指数点位毫无关系，若不丢弃会把分时图纵轴撑爆。
 * 美股/日韩行只有 3 个字段（无成交额）→ 均价为 null（不画均价线）。
 *
 * 昨收取 qt.<code>[4]（腾讯报价数组索引）。
 */
export function parseTencentMinuteNode(node?: TencentMinuteNode, code = ''): MinuteResult | null {
  const rows = node?.data?.data
  if (!rows?.length) return null

  const shareScale = tencentShareScale(code)
  const points: MinutePoint[] = []
  let prevCumVolume = 0
  let prevCumAmount = 0
  for (const row of rows) {
    const fields = tencentRowFields(row)
    const time = fields[0] ?? ''
    const price = Number(fields[1])
    const cumVolume = Number(fields[2])
    const cumAmount = fields.length > 3 ? Number(fields[3]) : Number.NaN
    // 价格 <= 0（含空字段 Number('')=0）视为该分钟无成交，跳过——与东财分支同口径。
    // 否则 0 价点会进入序列：被判为下跌、把图表纵轴撑到约 [-margin, 2×昨收]，
    // 分时线被压扁到上半区，价格线还会在底部拉出贯穿成交量区的假尖刺。
    if (!time || !Number.isFinite(price) || price <= 0) continue
    const hasCumVolume = Number.isFinite(cumVolume) && cumVolume >= 0
    // 每分钟增量（源为累计口径）；首点即累计值本身，回退（更小）按 0 处理
    const volume = hasCumVolume ? Math.max(0, cumVolume - prevCumVolume) : 0
    const amount =
      Number.isFinite(cumAmount) && cumAmount >= 0
        ? Math.max(0, cumAmount - prevCumAmount)
        : undefined
    if (hasCumVolume) prevCumVolume = cumVolume
    if (Number.isFinite(cumAmount) && cumAmount >= 0) prevCumAmount = cumAmount
    const derivedAvg =
      hasCumVolume && cumVolume > 0 && Number.isFinite(cumAmount) && cumAmount > 0
        ? cumAmount / (cumVolume * shareScale)
        : null
    const avg =
      derivedAvg !== null && Math.abs(derivedAvg - price) / price <= 0.5 ? derivedAvg : null
    points.push({
      time: shortTime(time),
      price,
      avg,
      volume,
      amount,
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
    const fullTime = formatMinuteTime(ts)
    points.push({
      time: shortTime(fullTime),
      // Yahoo epoch 转本地完整时间戳，触摸浮层展示「年月日 时分」
      timeFull: fullTime,
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

/**
 * 完整时间戳归一化为 "YYYY-MM-DD HH:mm"：
 * - "2026-08-19 09:30" / "2026-08-19 09:30:00" / "2026-08-19T09:30:00" → "2026-08-19 09:30"
 * - 无日期信息（腾讯 "0930"）→ undefined
 */
export function fullTimeOf(time: string): string | undefined {
  if (!time) return undefined
  const match = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})/.exec(time)
  if (!match) return undefined
  return `${match[1]} ${match[2]}`
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
    return {
      time: shortTime(time),
      // 合成输入即完整时间戳（跨零点对齐用），触摸浮层展示「年月日 时分」
      timeFull: fullTimeOf(time),
      price: agg.sum / agg.count,
      avg: null,
      volume: agg.volume,
    }
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
      // 合成输入即完整时间戳，触摸浮层展示「年月日 时分」
      timeFull: fullTimeOf(p.time),
      // 四舍五入到 4 位小数，避免浮点噪声（如 1392.8/6.7225=207.1863…）
      price: Math.round(price * 10000) / 10000,
      avg: null,
      volume: 0,
    })
  }
  return points
}
