/**
 * K 线图纯计算逻辑（与 canvas 绘制解耦，便于单元测试验证）。
 *
 * 覆盖：纵轴范围、价格→y 映射、柱中心 x、涨跌判定、K 线实体几何、
 * 移动平均（MA5/10/20）、成交量柱高度、价格/时间刻度，
 * 以及周期聚合（日→周/月/年，见 aggregateKlines）与 MACD（见 computeMACD）。
 * 组件只用这里导出的函数做布局计算，测试直接验证数学正确性。
 */

import type { KlinePoint } from '../types/stock'

/** 纵轴范围（已含上下边距） */
export interface KlineRange {
  minP: number
  maxP: number
}

/**
 * 纵轴范围：取 highs 最大值 / lows 最小值，上下各留 padRatio 边距。
 * - 空数据或非有限值：返回 [0, 1] 兜底
 * - 单值（min === max）：上下各扩 1，避免 0 范围除零
 */
export function computeKlineRange(
  klines: KlinePoint[],
  padRatio = 0.08,
  extras: ReadonlyArray<Array<number | null>> = [],
): KlineRange {
  let min = Infinity
  let max = -Infinity
  for (const k of klines) {
    if (Number.isFinite(k.high)) max = Math.max(max, k.high)
    if (Number.isFinite(k.low)) min = Math.min(min, k.low)
  }
  // 均线等叠加序列一并纳入上下界：可见窗口只有几十根时，MA60 这类长周期均线会落在
  // 窗口内 K 线的高低点之外（强趋势段），不并入就会被画到价格面板外（压住成交量面板）。
  for (const extra of extras) {
    for (const value of extra) {
      if (typeof value !== 'number' || !Number.isFinite(value)) continue
      max = Math.max(max, value)
      min = Math.min(min, value)
    }
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    return { minP: 0, maxP: 1 }
  }
  if (min === max) {
    min -= 1
    max += 1
  }
  const range = max - min
  // 全为正价时下界不再留到 0 以下：长期前复权序列（年 K 由月 K 聚合，跨度可达数百倍）
  // 的 6% 边距会把刻度压成负数，出现「-135.80」这类不存在的价格刻度
  const minP = min - range * padRatio
  return { minP: min > 0 ? Math.max(0, minP) : minP, maxP: max + range * padRatio }
}

/** 价格 → 画布 y（价格越高 y 越小；maxP → padT，minP → padT + priceH） */
export function priceToY(
  price: number,
  minP: number,
  maxP: number,
  padT: number,
  priceH: number,
): number {
  return padT + ((maxP - price) / (maxP - minP)) * priceH
}

/** 第 i 根 K 线柱中心 x（slot 布局：n=1 时居中，否则在 plotW 内均匀分布） */
export function indexToX(i: number, n: number, padL: number, plotW: number): number {
  if (n <= 1) return padL + plotW / 2
  return padL + (i / (n - 1)) * plotW
}

/** 涨跌判定：收盘 >= 开盘为涨（与全局红涨绿跌一致） */
export function isUpKline(k: Pick<KlinePoint, 'open' | 'close'>): boolean {
  return k.close >= k.open
}

/** K 线实体几何：顶/底 y 与高度（实体高度最小 1px，十字星也能看见） */
export function candleBody(
  yOpen: number,
  yClose: number,
): { top: number; bottom: number; height: number } {
  const top = Math.min(yOpen, yClose)
  const bottom = Math.max(yOpen, yClose)
  return { top, bottom, height: Math.max(1, bottom - top) }
}

/**
 * 图表均线周期（MA5 / MA20 / MA30 / MA60）：行情页 K 线图与分享海报共用同一套参数，
 * 避免「屏幕上是 MA5/20/30/60、海报上是 MA5/10/20」这种口径不一致。
 */
export const KLINE_MA_PERIODS: readonly number[] = [5, 20, 30, 60]

/**
 * 简单移动平均：前 period-1 个索引为 null，第 i 个 = (i-period+1 .. i) 收盘均值。
 * period <= 0 或空数组：全 null。
 */
export function computeMA(klines: KlinePoint[], period: number): Array<number | null> {
  const result: Array<number | null> = new Array(klines.length).fill(null)
  if (period <= 0 || klines.length === 0) return result
  let sum = 0
  for (let i = 0; i < klines.length; i += 1) {
    sum += klines[i]?.close ?? 0
    if (i >= period) sum -= klines[i - period]?.close ?? 0
    if (i >= period - 1) result[i] = sum / period
  }
  return result
}

/** 价格刻度：count 个自上而下等分价格（首= maxP，尾 = minP） */
export function priceGridLabels(minP: number, maxP: number, count = 5): number[] {
  const labels: number[] = []
  for (let i = 0; i < count; i += 1) {
    labels.push(maxP - ((maxP - minP) / (count - 1)) * i)
  }
  return labels
}

/** 时间刻度索引：count 个均匀覆盖 0..n-1 的索引（首=0，尾=n-1）；n=1 时仅 1 个刻度 */
export function timeLabelIndexes(n: number, count = 5): number[] {
  if (n <= 0) return []
  if (n === 1 || count <= 1) return [0]
  const indexes: number[] = []
  for (let i = 0; i < count; i += 1) {
    indexes.push(Math.min(n - 1, Math.round((i / (count - 1)) * (n - 1))))
  }
  return indexes
}

/** 时间刻度展示文本：日线 "2026-08-06" / 分钟线 "2026-08-05 14:55:00" → "08-06" */
export function formatKlineTime(time: string): string {
  const m = /^\d{4}-(\d{2}-\d{2})/.exec(time)
  return m ? m[1]! : time
}

// ---------------------------------------------------------------------------
// K 线周期（分时页 TAB 的日/周/月/年；分时走分时链路，不在此列）
// ---------------------------------------------------------------------------

/** K 线周期：日 / 周 / 月 / 年 */
export type KlinePeriod = 'day' | 'week' | 'month' | 'year'

/** 可聚合出的周期（日线不聚合，直接用源数据） */
export type KlineAggregatePeriod = Exclude<KlinePeriod, 'day'>

/** 日期解析：从 "2026-08-06" / "2026-08-06 14:55:00" 取 年/月/日；无法解析返回 null */
export function parseKlineDate(time: string): { y: number; m: number; d: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(time)
  if (!match) return null
  const y = Number(match[1])
  const m = Number(match[2])
  const d = Number(match[3])
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return null
  if (m < 1 || m > 12 || d < 1 || d > 31) return null
  return { y, m, d }
}

/**
 * 聚合分组键（同一根聚合 K 线共享同一个 key）：
 * - week：该周周一的日期（周一为一周起点，跨年周归属按周一所在年）；
 * - month："YYYY-MM"；year："YYYY"。
 * 无法解析时间的数据返回 null（调用方跳过该根，避免把脏数据并进错误的周期）。
 */
export function klineBucketKey(time: string, period: KlineAggregatePeriod): string | null {
  const date = parseKlineDate(time)
  if (!date) return null
  const month = String(date.m).padStart(2, '0')
  if (period === 'month') return `${date.y}-${month}`
  if (period === 'year') return String(date.y)
  // 周：UTC 计算该日期所在周的周一（getUTCDay: 0=周日 → 回退 6 天）
  const utc = Date.UTC(date.y, date.m - 1, date.d)
  const weekday = new Date(utc).getUTCDay()
  const monday = utc - ((weekday + 6) % 7) * 86400000
  return new Date(monday).toISOString().slice(0, 10)
}

/**
 * 周期聚合：把更细的 K 线合并为周 / 月 / 年 K 线。
 * - 开盘取区间首根开盘、收盘取区间末根收盘、最高/最低取区间极值、成交量/成交额求和；
 * - 时间取区间末根的日期（与东财/腾讯月线「归属到最后一个交易日」的口径一致）；
 * - 无法解析时间 / 价格非有限值的根直接跳过；区间不足一根时不产出（返回空数组）。
 * 用途：年 K 无任何国内直连源（东财历史节点不可用）时由月 K 聚合；
 * 周/月 K 直连失败时同样按此回退，保证 TAB 始终有数据可画。
 */
export function aggregateKlines(klines: KlinePoint[], period: KlineAggregatePeriod): KlinePoint[] {
  const result: KlinePoint[] = []
  let current: KlinePoint | null = null
  let currentKey = ''
  for (const k of klines) {
    if (!k) continue
    const key = klineBucketKey(k.time, period)
    if (key === null) continue
    if (!Number.isFinite(k.open) || !Number.isFinite(k.high)) continue
    if (!Number.isFinite(k.low) || !Number.isFinite(k.close)) continue
    if (!current || key !== currentKey) {
      if (current) result.push(current)
      currentKey = key
      current = {
        time: k.time,
        open: k.open,
        high: k.high,
        low: k.low,
        close: k.close,
        volume: Number.isFinite(k.volume) ? k.volume : 0,
        ...(k.amount !== undefined ? { amount: k.amount } : {}),
      }
      continue
    }
    current.high = Math.max(current.high, k.high)
    current.low = Math.min(current.low, k.low)
    current.close = k.close
    current.volume += Number.isFinite(k.volume) ? k.volume : 0
    if (k.amount !== undefined) current.amount = (current.amount ?? 0) + k.amount
    current.time = k.time
  }
  if (current) result.push(current)
  return result
}

/** K 线横轴刻度文本：日/周 → "08-06"，月 → "26-08"，年 → "2026" */
export function formatKlineAxisLabel(time: string, period: KlinePeriod): string {
  if (period === 'year') return time.slice(0, 4)
  if (period === 'month') return time.slice(2, 7)
  return formatKlineTime(time)
}

// ---------------------------------------------------------------------------
// MACD（12/26/9，国内软件口径：DIF = EMA12 - EMA26，DEA = EMA9(DIF)，柱 = 2×(DIF-DEA)）
// ---------------------------------------------------------------------------

/** EMA（指数移动平均）：首个有效值直接作为种子（与国内行情软件一致） */
export function computeEMA(values: number[], period: number): number[] {
  const result: number[] = []
  if (period <= 0) return values.map(() => Number.NaN)
  const alpha = 2 / (period + 1)
  let prev = Number.NaN
  for (const value of values) {
    const v = Number.isFinite(value) ? value : 0
    prev = Number.isFinite(prev) ? v * alpha + prev * (1 - alpha) : v
    result.push(prev)
  }
  return result
}

export interface MacdSeries {
  /** DIF（快慢均线差） */
  dif: number[]
  /** DEA（DIF 的 signal 周期 EMA） */
  dea: number[]
  /** MACD 柱：2 × (DIF - DEA)，正值为红、负值为绿 */
  hist: number[]
}

/** MACD 参数（国内默认 12/26/9） */
export const MACD_FAST = 12
export const MACD_SLOW = 26
export const MACD_SIGNAL = 9
/** 展示 MACD 所需的最少 K 线根数（slow + signal - 1，少于此值曲线无意义 → 不展示 MACD 面板） */
export const MACD_MIN_BARS = MACD_SLOW + MACD_SIGNAL - 1

/** 计算 MACD 三条序列（长度与 klines 一致；不足 MACD_MIN_BARS 根时调用方不展示面板） */
export function computeMACD(
  klines: KlinePoint[],
  fast = MACD_FAST,
  slow = MACD_SLOW,
  signal = MACD_SIGNAL,
): MacdSeries {
  const closes = klines.map((k) => (Number.isFinite(k?.close) ? k.close : 0))
  const emaFast = computeEMA(closes, fast)
  const emaSlow = computeEMA(closes, slow)
  const dif = closes.map((_, i) => (emaFast[i] ?? 0) - (emaSlow[i] ?? 0))
  const dea = computeEMA(dif, signal)
  const hist = dif.map((v, i) => 2 * (v - (dea[i] ?? 0)))
  return { dif, dea, hist }
}

/** 该批 K 线是否够画 MACD（不足则条目「有则展示、没有就不展示」地隐藏 MACD 面板） */
export function hasMacdData(klines: KlinePoint[], minBars = MACD_MIN_BARS): boolean {
  return klines.length >= minBars
}

/** 成交量柱高度：按 volMax 等比缩放并封顶；volMax 非正（无数据）时返回 0 */
export function volumeBarHeight(volume: number, volMax: number, volH: number): number {
  if (!(volMax > 0)) return 0
  return volH * Math.min((volume || 0) / volMax, 1)
}
