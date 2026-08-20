/**
 * K 线图纯计算逻辑（与 canvas 绘制解耦，便于单元测试验证）。
 *
 * 覆盖：纵轴范围、价格→y 映射、柱中心 x、涨跌判定、K 线实体几何、
 * 移动平均（MA5/10/20）、成交量柱高度、价格/时间刻度。
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
export function computeKlineRange(klines: KlinePoint[], padRatio = 0.08): KlineRange {
  let min = Infinity
  let max = -Infinity
  for (const k of klines) {
    if (Number.isFinite(k.high)) max = Math.max(max, k.high)
    if (Number.isFinite(k.low)) min = Math.min(min, k.low)
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    return { minP: 0, maxP: 1 }
  }
  if (min === max) {
    min -= 1
    max += 1
  }
  const range = max - min
  return { minP: min - range * padRatio, maxP: max + range * padRatio }
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

/** 成交量柱高度：按 volMax 等比缩放并封顶；volMax 非正（无数据）时返回 0 */
export function volumeBarHeight(volume: number, volMax: number, volH: number): number {
  if (!(volMax > 0)) return 0
  return volH * Math.min((volume || 0) / volMax, 1)
}
