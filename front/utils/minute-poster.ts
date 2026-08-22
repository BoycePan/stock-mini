/**
 * 分时分享海报：在海报画布上直接绘制当日分时走势图（深色海报配色）。
 *
 * 与 share-poster.ts 共用设计坐标系（宽 750）。绘制逻辑复用 utils/minute-session.ts 的
 * 时段模型（完整时段铺点 / 休盘留白 / 时间刻度）与 utils/minute.ts 的成交量方向计算，
 * 与屏幕分时组件（minute-chart）视觉一致：红涨绿跌分段价格线、金色均价线、
 * 昨收零轴高亮、按涨跌分色的成交量柱、时段时间刻度。
 *
 * 用法：页面把分时数据交给 buildMinutePosterChart 生成 PosterChart，
 * 再通过 renderSharePoster(target, data, { chart }) 渲染。
 */

import type { MinutePoint } from '../types/stock'
import { computeMinuteVolumeDirections } from './minute'
import {
  buildMinuteGrid,
  minuteToSlot,
  parseMinuteOfDay,
  sessionTimeLabels,
  type MinuteGrid,
  type MinuteSessionKind,
} from './minute-session'
import type { PosterChart } from './share-poster'

type CanvasCtx = WechatMiniprogram.CanvasRenderingContext.CanvasRenderingContext2D

const UP_COLOR = '#eb514d'
const DOWN_COLOR = '#20a66a'
/** 均价线（深色海报底，与 minute-chart 深色主题一致） */
const AVG_COLOR = '#f5b94a'
const GRID_COLOR = 'rgba(255,255,255,0.10)'
/** 昨收零轴（纵轴中间网格线） */
const ZERO_COLOR = 'rgba(255,255,255,0.55)'
const TEXT_COLOR = '#8b93a7'
/** 成交量柱配色（平 / 跌 / 涨，半透明叠加在深色底上） */
const VOL_FLAT_COLOR = 'rgba(195,206,222,0.5)'
const VOL_DOWN_COLOR = 'rgba(32,166,106,0.5)'
const VOL_UP_COLOR = 'rgba(235,81,77,0.5)'

/** 分时图面板总高度（设计坐标系），面板标题 / 内边距已在 share-poster 的 chart 区域扣除 */
export const MINUTE_PANEL_HEIGHT = 460

/** share-poster 组件 minuteChart 属性的数据结构 */
export interface MinutePosterChartData {
  points: MinutePoint[]
  /** 昨收（0 / 空 视为无基准线） */
  preClose: number
  /** 交易时段模型（utils/minute-session.ts 的 MinuteSessionKind） */
  session: MinuteSessionKind
  /** 图表面板标题（缺省「当日分时」） */
  title?: string
}

/** 生成海报内嵌分时图（面板标题 + 高度 + 绘制回调，捕获当前 points） */
export function buildMinutePosterChart(
  points: MinutePoint[],
  preClose: number,
  session: MinuteSessionKind,
  title = '当日分时',
): PosterChart {
  return {
    title,
    height: MINUTE_PANEL_HEIGHT,
    draw: (ctx, x, y, w, h) => drawMinuteOnPoster(ctx, points, preClose, session, x, y, w, h),
  }
}

/**
 * 按完整交易时段把数据点铺到真实时钟上（utils/minute-session.ts）：
 * 以首个数据点时间为锚点生成时段网格，逐点换算槽位。
 * 任一数据点时间无法对齐时段网格（解析失败 / 落在休盘时间 / 时间乱序）时返回 null，
 * 调用方回退为原有拉伸绘制，保证异常数据不出错。
 */
function buildPosterPadded(
  session: MinuteSessionKind,
  points: MinutePoint[],
): { grid: MinuteGrid; slots: number[] } | null {
  if (!session || session === 'continuous' || points.length === 0) return null
  const anchor = parseMinuteOfDay(points[0]?.time ?? '')
  if (anchor === null) return null
  const grid = buildMinuteGrid(session, anchor)
  if (!grid) return null
  const slots: number[] = []
  for (const p of points) {
    const minute = parseMinuteOfDay(p.time)
    if (minute === null) return null
    const slot = minuteToSlot(grid, minute)
    if (slot === null) return null
    if (slots.length > 0 && slot < (slots[slots.length - 1] as number)) return null
    slots.push(slot)
  }
  return { grid, slots }
}

/**
 * 时间标签短格式：Yahoo 等源返回 "yyyy-MM-dd HH:mm"，海报刻度只取 "HH:mm"；
 * 已是短格式的原样返回。
 */
function shortTimeLabel(time: string): string {
  const match = /(\d{2}:\d{2})$/.exec(time)
  return match ? (match[1] as string) : time
}

/**
 * 在 (x, y, w, h) 矩形内绘制当日分时图（价格区 + 成交量区 + 时间刻度）。
 * 该矩形为海报图表面板的内容区（不含面板标题行）。
 * 与屏幕组件 minute-chart 同口径：纵轴以昨收 0% 对称、价格线分段着色、
 * 均价线金色、成交量柱按分钟涨跌分色、完整时段模式未来分钟留白。
 */
export function drawMinuteOnPoster(
  ctx: CanvasCtx,
  points: MinutePoint[],
  preClose: number,
  session: MinuteSessionKind,
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  if (!points || points.length < 2) {
    ctx.fillStyle = TEXT_COLOR
    ctx.font = '24px sans-serif'
    ctx.textAlign = 'center'
    ctx.fillText('暂无分时数据', x + w / 2, y + h / 2)
    return
  }
  const n = points.length
  const hasPre = Number.isFinite(preClose) && preClose > 0

  // 纵轴范围：有昨收时以昨收 0% 为对称中心（取现价/均价相对昨收的最大偏离，留 8% 边距）
  let minP: number
  let maxP: number
  if (hasPre) {
    let dev = 0
    for (const p of points) {
      // 只统计正价格/正均价：0 价或 0 均价（无成交分钟）会让 |0-昨收| 撑爆纵轴
      if (Number.isFinite(p.price) && p.price > 0) dev = Math.max(dev, Math.abs(p.price - preClose))
      if (p.avg !== null && Number.isFinite(p.avg) && p.avg > 0)
        dev = Math.max(dev, Math.abs(p.avg - preClose))
    }
    // 平盘无波动时给一个最小对称幅度（昨收的 1%），避免 0 范围
    dev = Math.max(dev, preClose * 0.01)
    const margin = dev * 0.08
    minP = preClose - dev - margin
    maxP = preClose + dev + margin
  } else {
    let min = Infinity
    let max = -Infinity
    for (const p of points) {
      if (Number.isFinite(p.price) && p.price > 0) {
        min = Math.min(min, p.price)
        max = Math.max(max, p.price)
      }
      if (p.avg !== null && Number.isFinite(p.avg) && p.avg > 0) {
        min = Math.min(min, p.avg)
        max = Math.max(max, p.avg)
      }
    }
    if (!Number.isFinite(min) || !Number.isFinite(max)) {
      min = 0
      max = 1
    }
    if (min === max) {
      min -= 1
      max += 1
    }
    const range = max - min
    minP = min - range * 0.06
    maxP = max + range * 0.06
  }

  // 左侧价格刻度宽度自适应（右对齐在左侧留白内）
  ctx.font = '20px sans-serif'
  ctx.textAlign = 'left'
  const gridLabels: string[] = []
  for (let i = 0; i <= 4; i += 1) {
    gridLabels.push((maxP - ((maxP - minP) / 4) * i).toFixed(2))
  }
  let padL = 0
  for (const t of gridLabels) {
    const tw = ctx.measureText(t).width
    if (tw > padL) padL = tw
  }
  padL = Math.min(96, Math.max(44, padL + 12))
  const padR = 6
  const bottomPad = 26 // 底部时间刻度区
  // 无任何成交量数据的标的（指数/代理等）：不预留成交量区，价格区占满
  const hasVol = points.some((p) => (p.volume || 0) > 0)
  const volH = hasVol ? Math.max(60, Math.round((h - bottomPad) * 0.24)) : 0
  const gap = 8
  const priceH = h - bottomPad - volH - (hasVol ? gap : 0)
  const plotW = w - padL - padR
  const volTop = y + priceH + (hasVol ? gap : 0)
  const volBottom = y + h - bottomPad

  const priceY = (v: number) => y + ((maxP - v) / (maxP - minP)) * priceH
  // 完整时段模式：按真实时钟槽位铺点（未来分钟留白）；否则等分拉伸
  const padded = buildPosterPadded(session, points)
  const xOf = (i: number) =>
    padded
      ? x + padL + ((padded.slots[i] ?? 0) / (padded.grid.totalSlots - 1)) * plotW
      : x + padL + (n <= 1 ? plotW / 2 : (i / (n - 1)) * plotW)

  // 横向网格 + 价格刻度；纵轴已以昨收 0% 对称，中间网格线（i=2）即零轴
  ctx.lineWidth = 1
  ctx.textAlign = 'right'
  for (let i = 0; i <= 4; i += 1) {
    const gy = y + (priceH / 4) * i
    const isZero = hasPre && i === 2
    ctx.strokeStyle = isZero ? ZERO_COLOR : GRID_COLOR
    ctx.beginPath()
    ctx.moveTo(x + padL, gy)
    ctx.lineTo(x + w - padR, gy)
    ctx.stroke()
    ctx.fillStyle = isZero ? ZERO_COLOR : TEXT_COLOR
    ctx.fillText(isZero ? '0%' : (gridLabels[i] ?? ''), x + padL - 8, gy + 3)
  }

  // 价格线分段点：以昨收 0% 为界，穿越 0% 的线段在交点处拆分，保证单段内不跨 0%
  const baseY = hasPre ? priceY(preClose) : null
  const linePts: Array<{ x: number; y: number }> = points.map((p, i) => ({
    x: xOf(i),
    y: priceY(p.price ?? 0),
  }))
  const segPts: Array<{ x: number; y: number }> = []
  for (let i = 0; i < n - 1; i += 1) {
    const a = linePts[i]
    const b = linePts[i + 1]
    if (!a || !b) continue
    segPts.push(a)
    if (baseY !== null && ((a.y <= baseY && b.y > baseY) || (a.y > baseY && b.y <= baseY))) {
      const t = (baseY - a.y) / (b.y - a.y)
      segPts.push({ x: a.x + (b.x - a.x) * t, y: baseY })
    }
  }
  const lastPt = linePts[n - 1]
  if (lastPt) segPts.push(lastPt)

  // 价格线：突破 0% 用红色、跌破 0% 用绿色，同色相邻段合并为一条路径
  ctx.lineWidth = 1.5
  let runColor: string | null = null
  for (let i = 0; i < segPts.length - 1; i += 1) {
    const a = segPts[i]
    const b = segPts[i + 1]
    if (!a || !b) continue
    const mid = (a.y + b.y) / 2
    const color = baseY === null || mid <= baseY ? UP_COLOR : DOWN_COLOR
    if (runColor !== color) {
      if (runColor !== null) ctx.stroke()
      ctx.beginPath()
      ctx.moveTo(a.x, a.y)
      ctx.lineTo(b.x, b.y)
      ctx.strokeStyle = color
      runColor = color
    } else {
      ctx.lineTo(b.x, b.y)
    }
  }
  if (runColor !== null) ctx.stroke()

  // 均价线（金色）
  ctx.strokeStyle = AVG_COLOR
  ctx.lineWidth = 1.2
  ctx.beginPath()
  let avgDrawn = false
  for (let i = 0; i < n; i += 1) {
    const avg = points[i]?.avg
    if (avg === null || avg === undefined || !Number.isFinite(avg) || avg <= 0) continue
    const ay = priceY(avg)
    if (!avgDrawn) {
      ctx.moveTo(xOf(i), ay)
      avgDrawn = true
    } else {
      ctx.lineTo(xOf(i), ay)
    }
  }
  if (avgDrawn) ctx.stroke()

  // 成交量柱（下方区域）：每根柱按该分钟收盘价相对开盘价分色（涨红、跌绿、平盘白/灰），
  // 同色柱合并为一个 path 批量 fill 提升性能，无成交量数据时跳过
  if (hasVol) {
    const volMax = Math.max(...points.map((p) => p.volume || 0), 1)
    // 完整时段模式按真实槽位宽度画柱，避免数据点少时柱过宽
    const slotSize = padded ? plotW / padded.grid.totalSlots : plotW / n
    const bw = Math.max(1, slotSize * 0.6)
    const barH = (p: MinutePoint) => (volBottom - volTop) * Math.min((p.volume || 0) / volMax, 1)

    const dirs = computeMinuteVolumeDirections(points, hasPre ? preClose : null)
    const groups: Array<{ match: (i: number) => boolean; color: string }> = [
      { match: (i) => dirs[i] === 'flat', color: VOL_FLAT_COLOR },
      { match: (i) => dirs[i] === 'down', color: VOL_DOWN_COLOR },
      { match: (i) => dirs[i] === 'up', color: VOL_UP_COLOR },
    ]
    for (const g of groups) {
      ctx.beginPath()
      for (let i = 0; i < n; i += 1) {
        const p = points[i]
        if (!p || !g.match(i)) continue
        const bh = barH(p)
        if (bh <= 0) continue
        ctx.rect(xOf(i) - bw / 2, volBottom - bh, bw, bh)
      }
      ctx.fillStyle = g.color
      ctx.fill()
    }

    // 成交量区域分隔线
    ctx.strokeStyle = GRID_COLOR
    ctx.beginPath()
    ctx.moveTo(x + padL, volTop - 4)
    ctx.lineTo(x + w - padR, volTop - 4)
    ctx.stroke()
  }

  // 时间刻度：完整时段模式取固定时段标签（A股 09:30/10:30/11:30/13:00/15:00），
  // 拉伸模式取 5 个等分点实际时间（Yahoo 长格式自动截断为 HH:mm）
  ctx.fillStyle = TEXT_COLOR
  ctx.textAlign = 'center'
  ctx.font = '20px sans-serif'
  if (padded) {
    for (const label of sessionTimeLabels(padded.grid)) {
      ctx.fillText(
        label.text,
        x + padL + (label.slot / (padded.grid.totalSlots - 1)) * plotW,
        y + h - 8,
      )
    }
  } else {
    for (let i = 0; i <= 4; i += 1) {
      const idx = Math.min(n - 1, Math.round((i / 4) * (n - 1)))
      const t = points[idx]?.time ?? ''
      ctx.fillText(shortTimeLabel(t), xOf(idx), y + h - 8)
    }
  }
}
