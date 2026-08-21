/**
 * K 线分享海报：在海报画布上直接绘制 K 线走势图（深色海报配色）。
 *
 * 与 share-poster.ts 共用设计坐标系（宽 750）。绘制逻辑复用 utils/kline.ts 的纯计算
 * （纵轴范围 / 坐标映射 / 蜡烛几何 / 均线 / 刻度），保证与屏幕 K 线组件（kline-chart）
 * 视觉一致：红涨绿跌、MA5/10/20、成交量柱、最新价虚线标签。
 *
 * 用法：页面把 K 线数据交给 buildKlinePosterChart 生成 PosterChart，
 * 再通过 renderSharePoster(target, data, { chart }) 渲染。
 */

import type { KlinePoint } from '../types/stock'
import {
  candleBody,
  computeKlineRange,
  computeMA,
  formatKlineTime,
  indexToX,
  isUpKline,
  priceGridLabels,
  priceToY,
  timeLabelIndexes,
  volumeBarHeight,
} from './kline'
import type { PosterChart } from './share-poster'

type CanvasCtx = WechatMiniprogram.CanvasRenderingContext.CanvasRenderingContext2D

const UP_COLOR = '#eb514d'
const DOWN_COLOR = '#20a66a'
/** 均线配色（深色海报底，与 kline-chart 深色主题一致） */
const MA_COLORS = ['#f5b94a', '#c08ff0', '#6fa3ff']
const MA_LABELS = ['MA5', 'MA10', 'MA20'] as const
const MA_PERIODS = [5, 10, 20] as const
const GRID_COLOR = 'rgba(255,255,255,0.10)'
const TEXT_COLOR = '#8b93a7'

/** K 线面板总高度（设计坐标系），面板标题 / 内边距已在 share-poster 的 chart 区域扣除 */
export const KLINE_PANEL_HEIGHT = 470

/** 生成海报内嵌 K 线图（面板标题 + 高度 + 绘制回调，捕获当前 klines） */
export function buildKlinePosterChart(klines: KlinePoint[], title = 'K线走势'): PosterChart {
  return {
    title,
    height: KLINE_PANEL_HEIGHT,
    draw: (ctx, x, y, w, h) => drawKlineOnPoster(ctx, klines, x, y, w, h),
  }
}

/**
 * 在 (x, y, w, h) 矩形内绘制 K 线图（价格区 + 成交量区 + 时间刻度）。
 * 该矩形为海报图表面板的内容区（不含面板标题行）。
 */
export function drawKlineOnPoster(
  ctx: CanvasCtx,
  klines: KlinePoint[],
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  if (!klines || klines.length === 0) {
    ctx.fillStyle = TEXT_COLOR
    ctx.font = '24px sans-serif'
    ctx.textAlign = 'center'
    ctx.fillText('暂无K线数据', x + w / 2, y + h / 2)
    return
  }
  const n = klines.length
  const { minP, maxP } = computeKlineRange(klines, 0.06)

  // 左侧价格刻度宽度自适应
  ctx.font = '20px sans-serif'
  ctx.textAlign = 'left'
  const gridLabels = priceGridLabels(minP, maxP, 5)
  const labelTexts = gridLabels.map((v) => v.toFixed(2))
  let padL = 0
  for (const t of labelTexts) {
    const tw = ctx.measureText(t).width
    if (tw > padL) padL = tw
  }
  padL = Math.min(96, Math.max(44, padL + 12))
  const padR = 6
  const plotW = w - padL - padR
  const bottomPad = 26 // 底部时间刻度区
  const volH = Math.max(60, Math.round((h - bottomPad) * 0.24))
  const gap = 8
  const priceH = h - bottomPad - volH - gap
  const volTop = y + priceH + gap
  const volBottom = y + h - bottomPad
  const slot = plotW / n
  const candleW = Math.max(1.5, Math.min(16, slot * 0.62))
  const volMax = Math.max(...klines.map((k) => k.volume || 0), 1)

  // 横向网格 + 左侧价格刻度
  ctx.lineWidth = 1
  ctx.textAlign = 'right'
  for (let i = 0; i <= 4; i += 1) {
    const gy = y + (priceH / 4) * i
    ctx.strokeStyle = GRID_COLOR
    ctx.beginPath()
    ctx.moveTo(x + padL, gy)
    ctx.lineTo(x + w - padR, gy)
    ctx.stroke()
    ctx.fillStyle = TEXT_COLOR
    ctx.fillText(labelTexts[i] ?? '', x + padL - 6, gy + 3)
  }

  // 纵向时间分隔线
  const timeIdx = timeLabelIndexes(n, 5)
  ctx.strokeStyle = GRID_COLOR
  for (const idx of timeIdx) {
    const gx = x + indexToX(idx, n, padL, plotW)
    ctx.beginPath()
    ctx.moveTo(gx, y)
    ctx.lineTo(gx, volBottom)
    ctx.stroke()
  }

  // 成交量区：分隔线 + 最大量标注 + 按涨跌分色的柱
  ctx.strokeStyle = GRID_COLOR
  ctx.beginPath()
  ctx.moveTo(x + padL, volTop - 4)
  ctx.lineTo(x + w - padR, volTop - 4)
  ctx.stroke()
  ctx.fillStyle = TEXT_COLOR
  ctx.textAlign = 'left'
  ctx.font = '20px sans-serif'
  ctx.fillText(`量 ${formatVolume(volMax)}`, x + padL + 2, volTop - 8)

  const upRects: number[] = []
  const downRects: number[] = []
  for (let i = 0; i < n; i += 1) {
    const k = klines[i]
    if (!k) continue
    const bh = volumeBarHeight(k.volume || 0, volMax, volBottom - volTop)
    if (bh <= 0) continue
    const cx = x + indexToX(i, n, padL, plotW)
    const bw = Math.max(1.5, candleW * 0.72)
    if (isUpKline(k)) upRects.push(cx - bw / 2, volBottom - bh, bw, bh)
    else downRects.push(cx - bw / 2, volBottom - bh, bw, bh)
  }
  paintRects(ctx, upRects, UP_COLOR)
  paintRects(ctx, downRects, DOWN_COLOR)

  // 蜡烛：影线 + 圆角实体（红涨绿跌）
  for (let i = 0; i < n; i += 1) {
    const k = klines[i]
    if (!k) continue
    const cx = x + indexToX(i, n, padL, plotW)
    const color = isUpKline(k) ? UP_COLOR : DOWN_COLOR
    ctx.strokeStyle = color
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(cx, y + priceToY(k.high, minP, maxP, 0, priceH))
    ctx.lineTo(cx, y + priceToY(k.low, minP, maxP, 0, priceH))
    ctx.stroke()
    const yOpen = y + priceToY(k.open, minP, maxP, 0, priceH)
    const yClose = y + priceToY(k.close, minP, maxP, 0, priceH)
    const body = candleBody(yOpen, yClose)
    ctx.fillStyle = color
    roundRectPath(ctx, cx - candleW / 2, body.top, candleW, body.height, 1.5)
    ctx.fill()
  }

  // 均线 MA5/10/20
  const maSeries = MA_PERIODS.map((period) => computeMA(klines, period))
  for (let m = 0; m < maSeries.length; m += 1) {
    const values = maSeries[m]
    if (!values) continue
    ctx.strokeStyle = MA_COLORS[m] ?? '#999'
    ctx.lineWidth = 1.5
    ctx.beginPath()
    let started = false
    for (let i = 0; i < n; i += 1) {
      const v = values[i]
      if (v === null || v === undefined) continue
      const px = x + indexToX(i, n, padL, plotW)
      const py = y + priceToY(v, minP, maxP, 0, priceH)
      if (!started) {
        ctx.moveTo(px, py)
        started = true
      } else {
        ctx.lineTo(px, py)
      }
    }
    if (started) ctx.stroke()
  }
  // 均线图例（内容区上方，面板标题行下方）
  const lastIndex = n - 1
  ctx.font = '20px sans-serif'
  ctx.textAlign = 'left'
  let legendX = x + padL + 2
  for (let m = 0; m < MA_LABELS.length; m += 1) {
    const values = maSeries[m]
    const lastVal = values?.[lastIndex]
    const text = `${MA_LABELS[m]}:${lastVal === null || lastVal === undefined ? '--' : lastVal.toFixed(2)}`
    ctx.fillStyle = MA_COLORS[m] ?? '#999'
    ctx.fillText(text, legendX, y - 12)
    legendX += ctx.measureText(text).width + 12
  }

  // 底部日期刻度
  ctx.fillStyle = TEXT_COLOR
  ctx.textAlign = 'center'
  for (const idx of timeIdx) {
    const k = klines[idx]
    if (!k) continue
    ctx.fillText(formatKlineTime(k.time), x + indexToX(idx, n, padL, plotW), y + h - 8)
  }

  // 最新价虚线 + 右侧圆角标签（按最后一根涨跌着色）
  const last = klines[lastIndex]
  if (last) {
    const lastY = y + priceToY(last.close, minP, maxP, 0, priceH)
    const color = isUpKline(last) ? UP_COLOR : DOWN_COLOR
    ctx.strokeStyle = 'rgba(255,255,255,0.35)'
    ctx.lineWidth = 1
    ctx.setLineDash([4, 4])
    ctx.beginPath()
    ctx.moveTo(x + padL, lastY)
    ctx.lineTo(x + w - padR, lastY)
    ctx.stroke()
    ctx.setLineDash([])
    const label = last.close.toFixed(2)
    ctx.font = '20px sans-serif'
    const labelW = ctx.measureText(label).width + 12
    const tagX = x + w - padR - labelW
    const tagY = lastY - 10
    ctx.fillStyle = color
    roundRectPath(ctx, tagX, tagY, labelW, 18, 4)
    ctx.fill()
    ctx.fillStyle = '#ffffff'
    ctx.textAlign = 'center'
    ctx.fillText(label, tagX + labelW / 2, tagY + 13)
  }
}

/** 批量绘制矩形（rect 数组：x,y,w,h 依次排列；同色合并提升性能） */
function paintRects(ctx: CanvasCtx, rects: number[], color: string): void {
  if (!rects.length) return
  ctx.fillStyle = color
  ctx.beginPath()
  for (let i = 0; i < rects.length; i += 4) {
    ctx.rect(rects[i]!, rects[i + 1]!, rects[i + 2]!, rects[i + 3]!)
  }
  ctx.fill()
}

/** 圆角矩形路径（画完不自动 fill/stroke，由调用方决定） */
function roundRectPath(
  ctx: CanvasCtx,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const radius = Math.max(0, Math.min(r, w / 2, h / 2))
  ctx.beginPath()
  ctx.moveTo(x + radius, y)
  ctx.arcTo(x + w, y, x + w, y + h, radius)
  ctx.arcTo(x + w, y + h, x, y + h, radius)
  ctx.arcTo(x, y + h, x, y, radius)
  ctx.arcTo(x, y, x + radius, y, radius)
  ctx.closePath()
}

/** 成交量简写 */
function formatVolume(volume: number): string {
  if (!Number.isFinite(volume)) return '--'
  if (volume >= 100000000) return `${(volume / 100000000).toFixed(2)}亿`
  if (volume >= 10000) return `${(volume / 10000).toFixed(2)}万`
  return String(volume)
}
