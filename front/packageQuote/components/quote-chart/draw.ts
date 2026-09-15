/**
 * 行情图表绘制（分时 / 五日 / 日K / 周K / 月K / 年K）纯绘制模块。
 *
 * 设计原则：
 * - **不依赖小程序运行时**（只用结构化 canvas 2d 接口 ChartCtx），因此可在浏览器里用同一份
 *   代码渲染预览、也可被单测覆盖布局计算，不引入 wx.* 依赖；
 * - 布局计算（buildQuoteChartLayout）与绘制（renderChart / renderCrosshair）分离，
 *   触摸命中（hitTestIndex）复用同一份布局，保证「画的在哪、点的就在哪」；
 * - 三块面板纵向排列：价格 → 成交量 → MACD；成交量/MACD 无数据时整块隐藏，
 *   价格面板自动占满剩余高度（不出现空白条），即「有则展示、没有就不展示」。
 *
 * 布局（自上而下）：
 *   padT（K线放 MA 图例 / 分时留白）
 *   价格面板（横向网格 + 左侧价格刻度；分时以昨收为 0% 中线）
 *   成交量面板（柱：K线按涨跌分色，分时按该分钟相对上一分钟涨跌分色）
 *   MACD 面板（DIF / DEA 双线 + 红绿柱，零轴居中）
 *   底部时间 / 日期刻度
 */

import type { KlinePoint, MinutePoint } from '../../../types/stock'
import {
  candleBody,
  computeKlineRange,
  computeMA,
  computeMACD,
  formatKlineAxisLabel,
  hasMacdData,
  isUpKline,
  KLINE_MA_PERIODS,
  priceToY,
  volumeBarHeight,
  type KlinePeriod,
  type MacdSeries,
} from '../../../utils/kline'
import { fitMaLegend } from '../../../utils/kline-legend'
import { computeMinuteVolumeDirections } from '../../../utils/minute'
import {
  buildMinuteGrid,
  minuteDayLabel,
  minuteToSlot,
  parseMinuteOfDay,
  sessionTimeLabels,
  splitMinuteDays,
  type MinuteDaySlice,
  type MinuteGrid,
  type MinuteSessionKind,
} from '../../../utils/minute-session'

/** 图表模式：分时 / 五日 / 日K / 周K / 月K / 年K */
export type QuoteChartMode = 'minute' | 'fiveDay' | 'day' | 'week' | 'month' | 'year'

const KLINE_MODES: readonly QuoteChartMode[] = ['day', 'week', 'month', 'year']

export function isKlineMode(mode: QuoteChartMode): boolean {
  return KLINE_MODES.includes(mode)
}

/**
 * K 线均线周期（MA5 / MA20 / MA30 / MA60）：单一数据源见 utils/kline.ts 的 KLINE_MA_PERIODS，
 * 屏幕 K 线图与分享海报共用。均线一律在**全量** K 线上计算，再按可见窗口切片
 * （见 utils/kline-viewport.ts 的 buildKlineView）：分片视图若只在窗口内算 MA，
 * 窗口越小均线越短、MA60 直接画不出来。
 */
export const MA_PERIODS: readonly number[] = [...KLINE_MA_PERIODS]

/** K 线模式 → 周期（用于横轴刻度文案） */
export function klinePeriodOf(mode: QuoteChartMode): KlinePeriod {
  return isKlineMode(mode) ? (mode as KlinePeriod) : 'day'
}

/** 结构化 canvas 2d 接口（小程序 canvas 2d 与浏览器 canvas 均满足） */
export interface ChartCtx {
  fillStyle: string | CanvasGradient
  strokeStyle: string | CanvasGradient
  lineWidth: number
  font: string
  textAlign: 'left' | 'center' | 'right' | 'start' | 'end'
  clearRect(x: number, y: number, w: number, h: number): void
  scale(x: number, y: number): void
  fillRect(x: number, y: number, w: number, h: number): void
  beginPath(): void
  closePath(): void
  moveTo(x: number, y: number): void
  lineTo(x: number, y: number): void
  rect(x: number, y: number, w: number, h: number): void
  arc(x: number, y: number, r: number, start: number, end: number): void
  arcTo(x1: number, y1: number, x2: number, y2: number, r: number): void
  fill(): void
  stroke(): void
  fillText(text: string, x: number, y: number): void
  measureText(text: string): { width: number }
  setLineDash(dash: number[]): void
}

export interface QuoteChartData {
  mode: QuoteChartMode
  width: number
  height: number
  isDark: boolean
  /** 分时 / 五日数据点 */
  points: MinutePoint[]
  /** 分时基准价（昨收 / 昨结算），<=0 表示无基准 */
  preClose: number
  /** 分时交易时段模型（五日与 K 线不按时段铺点） */
  session: MinuteSessionKind
  /**
   * K 线数据（日/周/月/年模式）。
   * 分片视图（见 buildKlineView）传入的是**可见窗口**内的 K 线，
   * 因此均线 / MACD 必须由 maSeries / macd 一并传入，否则会在窗口内重算、缺失预热历史。
   */
  klines: KlinePoint[]
  /** 十字光标选中下标（null = 不显示） */
  activeIndex: number | null
  /** 预先算好的均线（与 klines 等长；缺省按 MA_PERIODS 在 klines 上现算） */
  maSeries?: Array<Array<number | null>>
  /** 均线周期（与 maSeries 一一对应；缺省 MA_PERIODS） */
  maPeriods?: number[]
  /** 预先算好的 MACD（与 klines 等长；缺省在 klines 上现算） */
  macd?: MacdSeries | null
  /** 是否展示 MACD 面板：分片视图按「全量根数」判定（30 根窗口不应隐藏 MACD） */
  showMacdPanel?: boolean
}

/** 分时完整时段铺点结果 */
interface PaddedLayout {
  grid: MinuteGrid
  slots: number[]
}

export interface QuoteChartLayout {
  mode: QuoteChartMode
  isKline: boolean
  width: number
  height: number
  isDark: boolean
  /** 数据根数（分时点数 / K 线根数） */
  n: number
  padL: number
  padR: number
  padT: number
  padB: number
  plotW: number
  priceTop: number
  priceH: number
  minP: number
  maxP: number
  volTop: number
  volH: number
  showVolume: boolean
  volMax: number
  macdTop: number
  macdH: number
  showMacd: boolean
  macdMax: number
  macd: MacdSeries | null
  /** 绘图区底边（最后一块**可见**面板的底边）：纵向网格线与十字光标竖线的下端点 */
  plotBottom: number
  /** 每根数据的 x 坐标 */
  xs: number[]
  /** 相邻 x 间距（等分模式下为 plotW/(n-1)） */
  step: number
  candleW: number
  /** 分时完整时段铺点（连续交易标的为 null） */
  padded: PaddedLayout | null
  /** 五日自然日分段（无日期信息时为空数组） */
  days: MinuteDaySlice[]
  /** 横轴刻度 */
  xTicks: Array<{ x: number; text: string }>
  /** 成交量柱方向（分时/五日按分钟涨跌，K线按当根涨跌） */
  volDirs: Array<'up' | 'down' | 'flat'>
  /** 均线序列（仅 K 线模式；长度与 data.klines 一致） */
  maSeries: Array<Array<number | null>>
  /** 均线周期（与 maSeries 一一对应，用于图例文案） */
  maPeriods: number[]
}

interface Palette {
  up: string
  down: string
  grid: string
  text: string
  textStrong: string
  zero: string
  box: string
  boxBorder: string
  avg: string
  dif: string
  dea: string
  ma: string[]
  flatVol: string
  /** 成交量柱（K线用实色、分时用半透明，避免密集柱糊成一片） */
  upVol: string
  downVol: string
}

function palette(isDark: boolean): Palette {
  return isDark
    ? {
        up: '#eb514d',
        down: '#20a66a',
        grid: 'rgba(255,255,255,0.08)',
        text: '#8a97a8',
        textStrong: '#c3cede',
        zero: 'rgba(255,255,255,0.5)',
        box: 'rgba(20,32,51,0.92)',
        boxBorder: 'rgba(255,255,255,0.2)',
        avg: '#f5b94a',
        dif: '#6fa3ff',
        dea: '#f5b94a',
        ma: ['#f5b94a', '#c08ff0', '#6fa3ff', '#4fd1c5'],
        flatVol: 'rgba(195,206,222,0.5)',
        upVol: 'rgba(235,81,77,0.5)',
        downVol: 'rgba(32,166,106,0.5)',
      }
    : {
        up: '#eb514d',
        down: '#20a66a',
        grid: 'rgba(20,32,51,0.08)',
        text: '#718096',
        textStrong: '#66758a',
        zero: 'rgba(20,32,51,0.5)',
        box: 'rgba(255,255,255,0.94)',
        boxBorder: 'rgba(20,32,51,0.15)',
        avg: '#f0a020',
        dif: '#4278ed',
        dea: '#f0a020',
        ma: ['#f0a020', '#a06ee0', '#4278ed', '#0f9b8e'],
        flatVol: 'rgba(154,167,184,0.65)',
        upVol: 'rgba(235,81,77,0.5)',
        downVol: 'rgba(32,166,106,0.5)',
      }
}

/** 价格面板横向网格条数（含首尾） */
const PRICE_GRID_LINES = 5
/** 面板间距 */
const PANEL_GAP = 15
/** MACD 面板最小高度 */
const MACD_MIN_H = 96
/** 成交量面板最小高度 */
const VOL_MIN_H = 56

/**
 * 计算图表布局（几何 + 数据映射），供绘制与触摸命中复用。
 * 需要 ctx 仅用于测量价格刻度文字宽度（决定左侧留白）。
 */
export function buildQuoteChartLayout(d: QuoteChartData, ctx: ChartCtx): QuoteChartLayout {
  const isKline = isKlineMode(d.mode)
  const n = isKline ? d.klines.length : d.points.length
  const isFiveDay = d.mode === 'fiveDay'
  const padR = 12
  const padB = 16
  const padT = isKline ? 24 : 18

  // 面板可见性：无成交量 / K 线不足 MACD 根数时整块隐藏，价格面板自动占满
  const showVolume = isKline
    ? d.klines.some((k) => (k.volume || 0) > 0)
    : d.points.some((p) => (p.volume || 0) > 0)
  // 分片视图（可见窗口）下 MACD 是否可画按全量根数判定：由调用方经 showMacdPanel 传入
  const showMacd = isKline && (d.showMacdPanel ?? hasMacdData(d.klines))
  const maPeriods = d.maPeriods ? [...d.maPeriods] : [...MA_PERIODS]

  const volH = showVolume
    ? Math.max(isKline ? VOL_MIN_H + 28 : VOL_MIN_H, Math.round(d.height * (isKline ? 0.17 : 0.22)))
    : 0
  const macdH = showMacd ? Math.max(MACD_MIN_H, Math.round(d.height * 0.24)) : 0
  const priceH = Math.max(
    60,
    d.height - padT - padB - (volH ? volH + PANEL_GAP : 0) - (macdH ? macdH + PANEL_GAP : 0),
  )
  const priceTop = padT
  const volTop = priceTop + priceH + PANEL_GAP
  const macdTop = volTop + (volH ? volH + PANEL_GAP : 0)
  // 绘图区底边 = 最后一块可见面板的底边：MACD 隐藏时不能再按 macdTop 往下算，
  // 否则纵向网格线与十字光标竖线会画到画布外（历史缺陷：分时图竖线超出 ~67px）
  const plotBottom = showMacd ? macdTop + macdH : showVolume ? volTop + volH : priceTop + priceH

  // 纵轴范围
  let minP: number
  let maxP: number
  const preClose = Number.isFinite(d.preClose) && d.preClose > 0 ? d.preClose : 0
  if (isKline) {
    // 均线一并纳入上下界：30 根窗口内 MA60 可能落在 K 线高低点之外（强趋势段），
    // 不并入会被画到价格面板外（压住成交量面板）
    const range = computeKlineRange(d.klines, 0.06, d.maSeries ?? [])
    minP = range.minP
    maxP = range.maxP
  } else if (preClose > 0) {
    // 分时 / 五日：以基准价（昨收）为 0% 中线，上下等幅，避免视觉上「涨跌不对称」
    let dev = 0
    for (const p of d.points) {
      if (Number.isFinite(p.price) && p.price > 0) dev = Math.max(dev, Math.abs(p.price - preClose))
      if (p.avg !== null && p.avg !== undefined && Number.isFinite(p.avg) && p.avg > 0) {
        dev = Math.max(dev, Math.abs(p.avg - preClose))
      }
    }
    dev = Math.max(dev, preClose * 0.01)
    const margin = dev * 0.08
    minP = preClose - dev - margin
    maxP = preClose + dev + margin
  } else {
    let min = Infinity
    let max = -Infinity
    for (const p of d.points) {
      if (Number.isFinite(p.price) && p.price > 0) {
        min = Math.min(min, p.price)
        max = Math.max(max, p.price)
      }
      if (p.avg !== null && p.avg !== undefined && Number.isFinite(p.avg) && p.avg > 0) {
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

  // 左侧留白：按价格刻度文字宽度自适应（保证刻度不被裁切，也不浪费绘图区）
  const labels = priceGridTexts(minP, maxP, isKline)
  ctx.font = '10px sans-serif'
  let labelW = 0
  for (const text of labels) {
    const w = ctx.measureText(text).width
    if (w > labelW) labelW = w
  }
  const padL = Math.min(120, Math.max(54, Math.round(labelW) + 14))
  const plotW = d.width - padL - padR

  // 分时完整时段铺点（连续交易标的 / 时间无法对齐时退化为等分拉伸）
  const padded = isKline || isFiveDay ? null : buildPadded(d.points, d.session)
  const xs: number[] = []
  let step: number
  if (padded) {
    const total = Math.max(1, padded.grid.totalSlots - 1)
    step = plotW / total
    for (let i = 0; i < n; i += 1) xs.push(padL + ((padded.slots[i] ?? 0) / total) * plotW)
  } else if (n <= 1) {
    step = plotW
    for (let i = 0; i < n; i += 1) xs.push(padL + plotW / 2)
  } else {
    step = plotW / (n - 1)
    for (let i = 0; i < n; i += 1) xs.push(padL + i * step)
  }

  const days = isFiveDay ? splitMinuteDays(d.points) : []
  const xTicks = buildXTicks({
    mode: d.mode,
    points: d.points,
    klines: d.klines,
    xs,
    days,
    padded,
    padL,
    plotW,
    n,
  })

  // 成交量方向与峰值
  const volDirs: Array<'up' | 'down' | 'flat'> = isKline
    ? d.klines.map((k) => (isUpKline(k) ? 'up' : 'down'))
    : computeMinuteVolumeDirections(d.points, preClose > 0 ? preClose : null)
  let volMax = 0
  if (isKline) {
    for (const k of d.klines) volMax = Math.max(volMax, k.volume || 0)
  } else {
    for (const p of d.points) volMax = Math.max(volMax, p.volume || 0)
  }

  // MACD（分片视图由调用方传入已算好的窗口切片）
  const macd = showMacd ? (d.macd ?? computeMACD(d.klines)) : null
  let macdMax = 0
  if (macd) {
    for (let i = 0; i < macd.dif.length; i += 1) {
      const v = Math.max(
        Math.abs(macd.dif[i] ?? 0),
        Math.abs(macd.dea[i] ?? 0),
        Math.abs(macd.hist[i] ?? 0),
      )
      if (Number.isFinite(v)) macdMax = Math.max(macdMax, v)
    }
    macdMax = macdMax > 0 ? macdMax * 1.08 : 0.01
  }

  // 均线：分片视图直接用调用方传入的窗口切片（在全量上算过），否则按 MA_PERIODS 现算
  const maSeries = isKline
    ? (d.maSeries ?? maPeriods.map((period) => computeMA(d.klines, period)))
    : []

  // 柱宽：K线较粗，分钟级（五日 ~1200 根）压到细柱避免糊成一片
  const slotWidth = n > 0 ? plotW / n : plotW
  const candleW = isKline
    ? Math.max(1, Math.min(11, slotWidth * 0.68))
    : Math.max(0.6, Math.min(9, slotWidth * 0.8))

  return {
    mode: d.mode,
    isKline,
    width: d.width,
    height: d.height,
    isDark: d.isDark,
    n,
    padL,
    padR,
    padT,
    padB,
    plotW,
    priceTop,
    priceH,
    minP,
    maxP,
    volTop,
    volH,
    showVolume,
    volMax,
    macdTop,
    macdH,
    showMacd,
    macdMax,
    macd,
    plotBottom,
    xs,
    step,
    candleW,
    padded,
    days,
    xTicks,
    volDirs,
    maSeries,
    maPeriods,
  }
}

function buildPadded(points: MinutePoint[], session: MinuteSessionKind): PaddedLayout | null {
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

interface XTickInput {
  mode: QuoteChartMode
  points: MinutePoint[]
  klines: KlinePoint[]
  xs: number[]
  days: MinuteDaySlice[]
  padded: PaddedLayout | null
  padL: number
  plotW: number
  n: number
}

/** 横轴刻度：K线取 5 等分（按周期格式化）、五日按自然日取段中点、分时取时段标签或 5 等分时间 */
function buildXTicks(input: XTickInput): Array<{ x: number; text: string }> {
  const { mode, points, klines, xs, days, padded, padL, plotW, n } = input
  if (n === 0) return []
  if (isKlineMode(mode)) {
    const period = klinePeriodOf(mode)
    const ticks: Array<{ x: number; text: string }> = []
    const used = new Set<number>()
    for (let i = 0; i < 5; i += 1) {
      const idx = n === 1 ? 0 : Math.min(n - 1, Math.round((i / 4) * (n - 1)))
      // 根数很少时多个刻度会落到同一下标（如仅 4 根年线）：去重避免同位置文字叠压
      if (used.has(idx)) continue
      used.add(idx)
      const bar = klines[idx]
      if (!bar) continue
      ticks.push({ x: xs[idx] ?? padL, text: formatKlineAxisLabel(bar.time, period) })
    }
    return ticks
  }
  if (mode === 'fiveDay' && days.length > 0) {
    return days.map((day) => {
      const start = xs[day.start] ?? padL
      const end = xs[day.end] ?? start
      return { x: (start + end) / 2, text: minuteDayLabel(day.date) }
    })
  }
  if (mode === 'fiveDay') {
    // 无日期信息（异常兜底）：退化为 5 等分时间标签
    const ticks: Array<{ x: number; text: string }> = []
    for (let i = 0; i < 5; i += 1) {
      const idx = n === 1 ? 0 : Math.min(n - 1, Math.round((i / 4) * (n - 1)))
      ticks.push({ x: xs[idx] ?? padL, text: points[idx]?.time ?? '' })
    }
    return ticks
  }
  if (padded) {
    const total = Math.max(1, padded.grid.totalSlots - 1)
    return sessionTimeLabels(padded.grid).map((label) => ({
      x: padL + (label.slot / total) * plotW,
      text: label.text,
    }))
  }
  const ticks: Array<{ x: number; text: string }> = []
  for (let i = 0; i < 5; i += 1) {
    const idx = n === 1 ? 0 : Math.min(n - 1, Math.round((i / 4) * (n - 1)))
    ticks.push({ x: xs[idx] ?? padL, text: points[idx]?.time ?? '' })
  }
  return ticks
}

/** 价格刻度文案：分时/五日的中间线为相对基准的 0%（其余显示价格） */
function priceGridTexts(minP: number, maxP: number, isKline: boolean): string[] {
  const texts: string[] = []
  for (let i = 0; i < PRICE_GRID_LINES; i += 1) {
    texts.push((maxP - ((maxP - minP) / (PRICE_GRID_LINES - 1)) * i).toFixed(2))
  }
  if (!isKline) texts[2] = '0%'
  return texts
}

/** 价格 → y（价格面板内） */
export function layoutPriceY(layout: QuoteChartLayout, price: number): number {
  return priceToY(price, layout.minP, layout.maxP, layout.priceTop, layout.priceH)
}

// ---------------------------------------------------------------------------
// 绘制
// ---------------------------------------------------------------------------

/** 绘制整张图（含清屏）；数据不足时画空态文案 */
export function renderChart(ctx: ChartCtx, d: QuoteChartData, layout: QuoteChartLayout): void {
  ctx.clearRect(0, 0, d.width, d.height)
  if (layout.n < 2) {
    ctx.fillStyle = palette(d.isDark).text
    ctx.font = '12px sans-serif'
    ctx.textAlign = 'center'
    ctx.fillText(emptyText(d.mode), d.width / 2, d.height / 2)
    return
  }
  const c = palette(d.isDark)
  drawPricePanel(ctx, d, layout, c)
  if (layout.showVolume) drawVolumePanel(ctx, d, layout, c)
  if (layout.showMacd && layout.macd) drawMacdPanel(ctx, d, layout, c)
  drawXTicks(ctx, layout, c)
}

export function emptyText(mode: QuoteChartMode): string {
  return isKlineMode(mode) ? '暂无K线数据' : '暂无分时数据'
}

/** 价格面板：网格 + 刻度 + （分时/五日）价格线与均价线 / （K线）蜡烛与均线 */
function drawPricePanel(
  ctx: ChartCtx,
  d: QuoteChartData,
  layout: QuoteChartLayout,
  c: Palette,
): void {
  const { padL, plotW, priceTop, priceH, minP, maxP } = layout
  const priceTexts = priceGridTexts(minP, maxP, layout.isKline)
  const preClose = Number.isFinite(d.preClose) && d.preClose > 0 ? d.preClose : 0

  // 横向网格 + 左侧刻度（分时/五日的中间线是 0% 基准：实线高亮）
  ctx.lineWidth = 1
  ctx.textAlign = 'right'
  for (let i = 0; i < PRICE_GRID_LINES; i += 1) {
    const y = priceTop + (priceH / (PRICE_GRID_LINES - 1)) * i
    const isBase = !layout.isKline && preClose > 0 && i === 2
    ctx.strokeStyle = isBase ? c.zero : c.grid
    ctx.beginPath()
    ctx.moveTo(padL, y)
    ctx.lineTo(padL + plotW, y)
    ctx.stroke()
    ctx.fillStyle = isBase ? c.zero : c.text
    ctx.fillText(priceTexts[i] ?? '', padL - 7, y + 3)
  }

  // 纵向网格：五日画自然日分隔（虚线，说明「跨日」），其余按横轴刻度轻描
  ctx.strokeStyle = c.grid
  if (d.mode === 'fiveDay' && layout.days.length > 1) {
    ctx.setLineDash([3, 4])
    for (const day of layout.days.slice(1)) {
      const x = layout.xs[day.start]
      if (x === undefined) continue
      ctx.beginPath()
      ctx.moveTo(x, priceTop)
      ctx.lineTo(x, layout.plotBottom)
      ctx.stroke()
    }
    ctx.setLineDash([])
  } else {
    for (const tick of layout.xTicks) {
      ctx.beginPath()
      ctx.moveTo(tick.x, priceTop)
      ctx.lineTo(tick.x, layout.plotBottom)
      ctx.stroke()
    }
  }

  if (layout.isKline) {
    drawCandles(ctx, d, layout, c)
    drawMaLines(ctx, d, layout, c)
    drawLastPriceTag(ctx, d, layout, c)
    return
  }

  // 分时 / 五日：价格线按基准价上下分段着色（红上绿下），均价线橙色
  const baseY = preClose > 0 ? layoutPriceY(layout, preClose) : null
  const linePts: Array<{ x: number; y: number } | null> = d.points.map((p, i) =>
    Number.isFinite(p.price) && p.price > 0
      ? { x: layout.xs[i] ?? padL, y: layoutPriceY(layout, p.price) }
      : null,
  )
  const segPts: Array<{ x: number; y: number }> = []
  for (let i = 0; i < linePts.length - 1; i += 1) {
    const a = linePts[i]
    const b = linePts[i + 1]
    if (!a || !b) continue
    segPts.push(a)
    if (baseY !== null && ((a.y <= baseY && b.y > baseY) || (a.y > baseY && b.y <= baseY))) {
      const t = (baseY - a.y) / (b.y - a.y)
      segPts.push({ x: a.x + (b.x - a.x) * t, y: baseY })
    }
  }
  const lastPt = linePts[linePts.length - 1]
  if (lastPt) segPts.push(lastPt)

  ctx.lineWidth = 1.5
  let runColor: string | null = null
  for (let i = 0; i < segPts.length - 1; i += 1) {
    const a = segPts[i]
    const b = segPts[i + 1]
    if (!a || !b) continue
    const mid = (a.y + b.y) / 2
    const color = baseY === null || mid <= baseY ? c.up : c.down
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

  ctx.strokeStyle = c.avg
  ctx.lineWidth = 1.2
  ctx.beginPath()
  let avgStarted = false
  for (let i = 0; i < d.points.length; i += 1) {
    const avg = d.points[i]?.avg
    if (avg === null || avg === undefined || !Number.isFinite(avg) || avg <= 0) {
      avgStarted = false
      continue
    }
    const x = layout.xs[i] ?? padL
    const y = layoutPriceY(layout, avg)
    if (!avgStarted) {
      ctx.moveTo(x, y)
      avgStarted = true
    } else {
      ctx.lineTo(x, y)
    }
  }
  if (avgStarted) ctx.stroke()
}

/** K 线蜡烛（影线 + 实体，红涨绿跌） */
function drawCandles(ctx: ChartCtx, d: QuoteChartData, layout: QuoteChartLayout, c: Palette): void {
  const { candleW } = layout
  for (let i = 0; i < d.klines.length; i += 1) {
    const k = d.klines[i]
    if (!k) continue
    const x = layout.xs[i] ?? 0
    const up = isUpKline(k)
    const color = up ? c.up : c.down
    ctx.strokeStyle = color
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(x, layoutPriceY(layout, k.high))
    ctx.lineTo(x, layoutPriceY(layout, k.low))
    ctx.stroke()
    const body = candleBody(layoutPriceY(layout, k.open), layoutPriceY(layout, k.close))
    ctx.fillStyle = color
    roundRectPath(ctx, x - candleW / 2, body.top, candleW, body.height, 1)
    ctx.fill()
  }
}

/**
 * MA5 / MA20 / MA30 / MA60 均线 + 左上角图例（有十字光标时显示该根数值）。
 * 图例排版走 utils/kline-legend.ts 的 fitMaLegend（放不下自动降级字号 / 去掉数值），
 * 与 kline-chart 组件共用同一套排版规则。
 */
function drawMaLines(ctx: ChartCtx, d: QuoteChartData, layout: QuoteChartLayout, c: Palette): void {
  const active = d.activeIndex !== null ? d.activeIndex : Math.max(0, layout.n - 1)
  ctx.lineWidth = 1
  for (let m = 0; m < layout.maSeries.length; m += 1) {
    const values = layout.maSeries[m]
    if (!values) continue
    ctx.strokeStyle = c.ma[m] ?? c.text
    ctx.beginPath()
    let started = false
    for (let i = 0; i < values.length; i += 1) {
      const v = values[i]
      if (v === null || v === undefined || !Number.isFinite(v)) {
        started = false
        continue
      }
      const x = layout.xs[i] ?? 0
      const y = layoutPriceY(layout, v)
      if (!started) {
        ctx.moveTo(x, y)
        started = true
      } else {
        ctx.lineTo(x, y)
      }
    }
    if (started) ctx.stroke()
  }

  // 图例：MA5:xx MA20:xx MA30:xx MA60:xx（顶行，颜色与曲线一致）
  const legend = fitMaLegend(ctx, {
    periods: layout.maPeriods,
    padL: layout.padL,
    plotW: layout.plotW,
    valueOf: (index) => layout.maSeries[index]?.[active],
  })
  ctx.textAlign = 'left'
  for (const item of legend.items) {
    ctx.font = legend.font
    ctx.fillStyle = c.ma[item.colorIndex] ?? c.text
    ctx.fillText(item.text, item.x, layout.priceTop - 8)
  }
}

/** 最新价虚线 + 右侧圆角标签（K 线模式；分时/五日不常驻价格标签，最新价在基本信息卡） */
function drawLastPriceTag(
  ctx: ChartCtx,
  d: QuoteChartData,
  layout: QuoteChartLayout,
  c: Palette,
): void {
  const last = d.klines[layout.n - 1]
  if (!last) return
  const y = layoutPriceY(layout, last.close)
  const color = isUpKline(last) ? c.up : c.down
  ctx.strokeStyle = c.zero
  ctx.setLineDash([4, 4])
  ctx.beginPath()
  ctx.moveTo(layout.padL, y)
  ctx.lineTo(layout.padL + layout.plotW, y)
  ctx.stroke()
  ctx.setLineDash([])
  const text = last.close.toFixed(2)
  ctx.font = '10px sans-serif'
  const w = ctx.measureText(text).width + 10
  const tagX = layout.padL + layout.plotW - w
  const tagY = y - 8
  ctx.fillStyle = color
  roundRectPath(ctx, tagX, tagY, w, 16, 3)
  ctx.fill()
  ctx.fillStyle = '#ffffff'
  ctx.textAlign = 'center'
  ctx.fillText(text, tagX + w / 2, tagY + 11.5)
}

/** 成交量面板：分隔线 + 顶行标注（有十字光标时显示该根成交量）+ 柱 */
function drawVolumePanel(
  ctx: ChartCtx,
  d: QuoteChartData,
  layout: QuoteChartLayout,
  c: Palette,
): void {
  const { padL, plotW, volTop, volH } = layout
  ctx.strokeStyle = c.grid
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(padL, volTop - 6)
  ctx.lineTo(padL + plotW, volTop - 6)
  ctx.stroke()

  const active = d.activeIndex
  const activeVolume =
    active !== null
      ? layout.isKline
        ? (d.klines[active]?.volume ?? 0)
        : (d.points[active]?.volume ?? 0)
      : null
  ctx.textAlign = 'left'
  ctx.font = '10px sans-serif'
  ctx.fillStyle = c.text
  const head =
    activeVolume !== null
      ? `量 ${formatVolume(activeVolume)}`
      : layout.isKline
        ? `量 ${formatVolume(layout.volMax)}`
        : '成交量'
  ctx.fillText(head, padL + 2, volTop - 10)

  const volBottom = volTop + volH
  const bw = Math.max(0.6, Math.min(layout.candleW, layout.step > 0 ? layout.step * 0.72 : 4))
  const groups: Array<{ dir: 'up' | 'down' | 'flat'; color: string }> = [
    { dir: 'flat', color: c.flatVol },
    { dir: 'down', color: layout.isKline ? c.down : c.downVol },
    { dir: 'up', color: layout.isKline ? c.up : c.upVol },
  ]
  for (const group of groups) {
    ctx.beginPath()
    let any = false
    for (let i = 0; i < layout.n; i += 1) {
      if (layout.volDirs[i] !== group.dir) continue
      const volume = layout.isKline ? (d.klines[i]?.volume ?? 0) : (d.points[i]?.volume ?? 0)
      const h = volumeBarHeight(volume, layout.volMax, volH)
      if (h <= 0) continue
      const x = layout.xs[i] ?? 0
      ctx.rect(x - bw / 2, volBottom - h, bw, h)
      any = true
    }
    if (any) {
      ctx.fillStyle = group.color
      ctx.fill()
    }
  }
}

/** MACD 面板：零轴居中的网格 + 红绿柱 + DIF/DEA 双线 + 顶行数值 */
function drawMacdPanel(
  ctx: ChartCtx,
  d: QuoteChartData,
  layout: QuoteChartLayout,
  c: Palette,
): void {
  const { padL, plotW, macdTop, macdH, macd, macdMax } = layout
  if (!macd) return
  const yOf = (v: number) => macdTop + macdH / 2 - (v / macdMax) * (macdH / 2)

  ctx.strokeStyle = c.grid
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(padL, macdTop - 6)
  ctx.lineTo(padL + plotW, macdTop - 6)
  ctx.stroke()

  // 上边界 / 零轴 / 下边界 + 左侧刻度（零轴高亮）
  const gridValues = [macdMax, 0, -macdMax]
  ctx.textAlign = 'right'
  for (const value of gridValues) {
    const y = yOf(value)
    ctx.strokeStyle = value === 0 ? c.zero : c.grid
    ctx.beginPath()
    ctx.moveTo(padL, y)
    ctx.lineTo(padL + plotW, y)
    ctx.stroke()
    ctx.fillStyle = value === 0 ? c.zero : c.text
    ctx.fillText(value === 0 ? '0' : value.toFixed(2), padL - 7, y + 3)
  }

  // 红绿柱（同色合并批量绘制）
  const zeroY = yOf(0)
  const bw = Math.max(0.6, Math.min(layout.candleW, layout.step > 0 ? layout.step * 0.7 : 4))
  const histGroups: Array<{ up: boolean; color: string }> = [
    { up: false, color: c.down },
    { up: true, color: c.up },
  ]
  for (const group of histGroups) {
    ctx.beginPath()
    let any = false
    for (let i = 0; i < layout.n; i += 1) {
      const v = macd.hist[i] ?? 0
      if (!Number.isFinite(v) || v === 0) continue
      if (v > 0 !== group.up) continue
      const y = yOf(v)
      const top = Math.min(y, zeroY)
      const h = Math.max(1, Math.abs(zeroY - y))
      const x = layout.xs[i] ?? 0
      ctx.rect(x - bw / 2, top, bw, h)
      any = true
    }
    if (any) {
      ctx.fillStyle = group.color
      ctx.fill()
    }
  }

  // DIF / DEA 双线
  const lines: Array<{ values: number[]; color: string }> = [
    { values: macd.dif, color: c.dif },
    { values: macd.dea, color: c.dea },
  ]
  ctx.lineWidth = 1.1
  for (const line of lines) {
    ctx.strokeStyle = line.color
    ctx.beginPath()
    let started = false
    for (let i = 0; i < line.values.length; i += 1) {
      const v = line.values[i]
      if (v === undefined || !Number.isFinite(v)) {
        started = false
        continue
      }
      const x = layout.xs[i] ?? 0
      const y = yOf(v)
      if (!started) {
        ctx.moveTo(x, y)
        started = true
      } else {
        ctx.lineTo(x, y)
      }
    }
    if (started) ctx.stroke()
  }

  // 顶行数值：MACD(12,26,9) + 选中/最新一根的三值
  const index = d.activeIndex !== null ? d.activeIndex : layout.n - 1
  const dif = macd.dif[index]
  const dea = macd.dea[index]
  const hist = macd.hist[index]
  ctx.textAlign = 'left'
  ctx.font = '10px sans-serif'
  ctx.fillStyle = c.text
  let headX = padL + 2
  const head = 'MACD(12,26,9)'
  ctx.fillText(head, headX, macdTop - 10)
  headX += ctx.measureText(head).width + 8
  const items: Array<{ text: string; color: string }> = [
    { text: `DIF:${fmtMacd(dif)}`, color: c.dif },
    { text: `DEA:${fmtMacd(dea)}`, color: c.dea },
    { text: `MACD:${fmtMacd(hist)}`, color: (hist ?? 0) >= 0 ? c.up : c.down },
  ]
  for (const item of items) {
    ctx.fillStyle = item.color
    ctx.fillText(item.text, headX, macdTop - 10)
    headX += ctx.measureText(item.text).width + 8
  }
}

/** 底部横轴刻度（K线/五日/分时共用；首尾标签内收避免出界） */
function drawXTicks(ctx: ChartCtx, layout: QuoteChartLayout, c: Palette): void {
  ctx.fillStyle = c.text
  ctx.font = '10px sans-serif'
  ctx.textAlign = 'center'
  const y = layout.height - 4
  const first = layout.xTicks[0]
  for (let i = 0; i < layout.xTicks.length; i += 1) {
    const tick = layout.xTicks[i]
    if (!tick) continue
    let x = tick.x
    const half = ctx.measureText(tick.text).width / 2
    if (i === 0 || x - half < layout.padL) x = layout.padL + half
    if (x + half > layout.padL + layout.plotW) x = layout.padL + layout.plotW - half
    ctx.fillText(tick.text, x, y)
  }
  void first
}

/** 十字光标 + 信息框（同花顺式）：竖线贯穿三块面板，横线在价格面板 */
export function renderCrosshair(ctx: ChartCtx, d: QuoteChartData, layout: QuoteChartLayout): void {
  const idx = d.activeIndex
  if (idx === null || layout.n < 2) return
  const c = palette(d.isDark)
  const x = layout.xs[idx]
  if (x === undefined) return
  const isKline = layout.isKline
  const bar = isKline ? d.klines[idx] : undefined
  const point = isKline ? undefined : d.points[idx]
  if (isKline && !bar) return
  if (!isKline && !point) return

  const value = isKline ? (bar as KlinePoint).close : (point as MinutePoint).price
  const y = layoutPriceY(layout, value)
  const up = isKline
    ? isUpKline(bar as KlinePoint)
    : Number.isFinite(d.preClose) && d.preClose > 0
      ? value >= d.preClose
      : true
  const mainColor = up ? c.up : c.down

  const bottom = layout.plotBottom
  ctx.strokeStyle = layout.isDark ? 'rgba(255,255,255,0.4)' : 'rgba(20,32,51,0.35)'
  ctx.lineWidth = 1
  ctx.setLineDash([4, 3])
  ctx.beginPath()
  ctx.moveTo(x, layout.priceTop)
  ctx.lineTo(x, bottom)
  ctx.stroke()
  ctx.beginPath()
  ctx.moveTo(layout.padL, y)
  ctx.lineTo(layout.padL + layout.plotW, y)
  ctx.stroke()
  ctx.setLineDash([])

  ctx.fillStyle = mainColor
  ctx.beginPath()
  ctx.arc(x, y, 3.5, 0, Math.PI * 2)
  ctx.fill()

  // 信息框内容按模式区分
  const rows: Array<{ text: string; color: string }> = []
  const rowColor = layout.isDark ? '#c3cede' : '#66758a'
  if (isKline) {
    const k = bar as KlinePoint
    const prevClose = idx > 0 ? d.klines[idx - 1]?.close : undefined
    const hasPrev = prevClose !== undefined && Number.isFinite(prevClose) && prevClose !== 0
    rows.push({ text: `时间 ${k.time}`, color: rowColor })
    rows.push({ text: `开 ${k.open.toFixed(2)}`, color: rowColor })
    rows.push({ text: `高 ${k.high.toFixed(2)}`, color: rowColor })
    rows.push({ text: `低 ${k.low.toFixed(2)}`, color: rowColor })
    rows.push({ text: `收 ${k.close.toFixed(2)}`, color: mainColor })
    if (hasPrev) {
      const change = k.close - (prevClose as number)
      const pct = (change / (prevClose as number)) * 100
      rows.push({
        text: `涨跌 ${sign(change)}${change.toFixed(2)}  ${sign(pct)}${pct.toFixed(2)}%`,
        color: change >= 0 ? c.up : c.down,
      })
    }
    if ((k.volume || 0) > 0) {
      rows.push({ text: `量 ${formatVolume(k.volume || 0)}`, color: rowColor })
    }
  } else {
    const p = point as MinutePoint
    rows.push({ text: `时间 ${p.timeFull || p.time}`, color: rowColor })
    rows.push({ text: `价格 ${p.price.toFixed(2)}`, color: mainColor })
    if (Number.isFinite(d.preClose) && d.preClose > 0) {
      const change = p.price - d.preClose
      const pct = (change / d.preClose) * 100
      rows.push({
        text: `涨跌 ${sign(change)}${change.toFixed(2)}  ${sign(pct)}${pct.toFixed(2)}%`,
        color: change >= 0 ? c.up : c.down,
      })
    }
    if (p.avg !== null && p.avg !== undefined && Number.isFinite(p.avg) && p.avg > 0) {
      rows.push({ text: `均价 ${p.avg.toFixed(2)}`, color: c.avg })
      ctx.fillStyle = c.avg
      ctx.beginPath()
      ctx.arc(x, layoutPriceY(layout, p.avg), 3, 0, Math.PI * 2)
      ctx.fill()
    }
    if ((p.volume || 0) > 0) {
      rows.push({ text: `量 ${formatVolume(p.volume)}`, color: rowColor })
    }
  }

  // 信息框：优先十字线右侧，越界翻到左侧；纵向贴顶
  const lineHeight = 15
  ctx.font = '10px sans-serif'
  ctx.textAlign = 'left'
  let boxW = 0
  for (const row of rows) boxW = Math.max(boxW, ctx.measureText(row.text).width)
  boxW += 14
  const boxH = rows.length * lineHeight + 8
  let boxX = x + 10
  if (boxX + boxW > layout.padL + layout.plotW) boxX = x - 10 - boxW
  // 先保证不超出画布右侧，再保证不压住左侧价格刻度（刻度被遮挡就无法读数）
  boxX = Math.min(boxX, layout.width - 4 - boxW)
  boxX = Math.max(layout.padL + 2, boxX)
  let boxY = layout.priceTop + 4
  if (boxY + boxH > layout.height - layout.padB) boxY = layout.height - layout.padB - boxH

  ctx.fillStyle = c.box
  ctx.strokeStyle = c.boxBorder
  ctx.lineWidth = 1
  roundRectPath(ctx, boxX, boxY, boxW, boxH, 4)
  ctx.fill()
  ctx.stroke()
  rows.forEach((row, i) => {
    ctx.fillStyle = row.color
    ctx.fillText(row.text, boxX + 7, boxY + 12 + i * lineHeight)
  })
}

/**
 * 触摸 x → 数据下标：
 * - 分时完整时段模式：先换算到时段槽位，再取最近的真实数据点（未来空白区不会命中右侧空点）；
 * - 其余模式（K线 / 五日 / 连续分时）：按等分步长直接反算。
 */
export function hitTestIndex(layout: QuoteChartLayout, x: number): number | null {
  if (layout.n < 2) return null
  if (layout.padded) {
    const total = Math.max(1, layout.padded.grid.totalSlots - 1)
    const touched = Math.round(((x - layout.padL) / layout.plotW) * total)
    const target = Math.max(0, Math.min(total, touched))
    let best = 0
    let bestDist = Infinity
    layout.padded.slots.forEach((slot, i) => {
      const dist = Math.abs(slot - target)
      if (dist < bestDist) {
        bestDist = dist
        best = i
      }
    })
    return best
  }
  if (layout.step <= 0) return null
  const raw = Math.round((x - layout.padL) / layout.step)
  return Math.max(0, Math.min(layout.n - 1, raw))
}

function roundRectPath(ctx: ChartCtx, x: number, y: number, w: number, h: number, r: number): void {
  const radius = Math.max(0, Math.min(r, w / 2, h / 2))
  ctx.beginPath()
  ctx.moveTo(x + radius, y)
  ctx.arcTo(x + w, y, x + w, y + h, radius)
  ctx.arcTo(x + w, y + h, x, y + h, radius)
  ctx.arcTo(x, y + h, x, y, radius)
  ctx.arcTo(x, y, x + w, y, radius)
  ctx.closePath()
}

/** 成交量 / 成交额简写 */
export function formatVolume(volume: number): string {
  if (!Number.isFinite(volume)) return '--'
  if (volume >= 100000000) return `${(volume / 100000000).toFixed(2)}亿`
  if (volume >= 10000) return `${(volume / 10000).toFixed(2)}万`
  return String(Math.round(volume))
}

function fmtMacd(value: number | undefined): string {
  return value === undefined || !Number.isFinite(value) ? '--' : value.toFixed(3)
}

function sign(value: number): string {
  return value >= 0 ? '+' : ''
}
