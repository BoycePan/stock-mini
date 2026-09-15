/**
 * K 线可见窗口（缩放 / 平移）纯函数模块：**不依赖 wx 与具体图表组件**，可单测。
 *
 * 两个图表组件共用同一套窗口模型，保证手感一致：
 * - `packageQuote/components/quote-chart`（行情页 日/周/月/年 K，下方有 − + ‹ › 控件）；
 * - `packageQuote/components/kline-chart`（板块 / 个股详情页的 K 线卡片）。
 *
 * 窗口模型：`{ viewBars, viewEnd }`
 * - `viewBars` = 可见根数（默认 30，松开手指后永远是整数根，缩放 / 平移都按整根吸附）；
 * - `viewEnd` = 窗口最后一根的**全量下标**（含），窗口左端 = `viewEnd - viewBars + 1`。
 *
 * 缩放的上下限（「缩放和放大要有限制」）：
 * - 放大上限：`MIN_VIEW_BARS`（10 根，再放大没有意义且蜡烛会糊）；
 * - 缩小上限：全量根数（一次看完全部历史，不会出现窗口比数据还长的空图）。
 * 触摸手势（单指拖动平移 / 双指捏合缩放）一律经 `clampViewport` 收口，越界会被夹回。
 */

import type { KlinePoint } from '../types/stock'
import { computeMA, computeMACD, hasMacdData, KLINE_MA_PERIODS, type MacdSeries } from './kline'

/** 可见窗口默认根数（默认只画最近 30 根，其余靠手势 / 控件调出） */
export const DEFAULT_VIEW_BARS = 30
/** 可见窗口最小根数（放大到极限） */
export const MIN_VIEW_BARS = 10
/** 点击 − + 缩放的比例：放大 = ×0.7 根数，缩小 = ÷0.7 根数 */
const ZOOM_RATIO = 0.7
/** 点击 ‹ › 平移的步长（可见根数的比例） */
const PAN_RATIO = 0.6
/** 双指缩放的死区：指距变化小于该比例时忽略，避免手指抖动把窗口来回抖 */
const PINCH_DEAD_ZONE = 0.02

/** K 线可见窗口状态 */
export interface ViewportState {
  viewBars: number
  viewEnd: number
}

/** 把窗口状态夹到合法范围（根数 ∈ [MIN_VIEW_BARS, 总根数]，末根下标 ∈ [0, 总数-1]） */
export function clampViewport(total: number, viewBars: number, viewEnd: number): ViewportState {
  if (total <= 0) return { viewBars: DEFAULT_VIEW_BARS, viewEnd: -1 }
  const minBars = Math.min(MIN_VIEW_BARS, total)
  const bars = Math.max(
    minBars,
    Math.min(total, Math.round(Number.isFinite(viewBars) ? viewBars : DEFAULT_VIEW_BARS)),
  )
  let end = Math.round(Number.isFinite(viewEnd) ? viewEnd : total - 1)
  end = Math.max(0, Math.min(total - 1, end))
  // 窗口左边界不足（贴近历史起点）时整体右移，保证始终有 bars 根可画
  if (end - bars + 1 < 0) end = Math.min(total - 1, bars - 1)
  return { viewBars: bars, viewEnd: end }
}

/** 首次进入某周期时的默认窗口：最新的一段 */
export function defaultViewport(total: number): ViewportState {
  return clampViewport(total, DEFAULT_VIEW_BARS, total - 1)
}

/** 缩放窗口（'in' 放大 = 更少根数看得更细；'out' 缩小 = 更多根数），右端锚定 */
export function zoomViewport(
  total: number,
  state: ViewportState,
  dir: 'in' | 'out',
): ViewportState {
  const current = clampViewport(total, state.viewBars, state.viewEnd)
  const raw =
    dir === 'in'
      ? Math.round(current.viewBars * ZOOM_RATIO)
      : Math.round(current.viewBars / ZOOM_RATIO)
  // 至少变化 1 根：根数很小时取整会得到同一值，按钮点了没反应
  const next =
    dir === 'in' ? Math.min(current.viewBars - 1, raw) : Math.max(current.viewBars + 1, raw)
  return clampViewport(total, next, current.viewEnd)
}

/** 左右平移窗口（step = 可见根数的 60%，最少 1 根） */
export function panViewport(
  total: number,
  state: ViewportState,
  dir: 'left' | 'right',
): ViewportState {
  const current = clampViewport(total, state.viewBars, state.viewEnd)
  const step = Math.max(1, Math.round(current.viewBars * PAN_RATIO))
  const end = dir === 'left' ? current.viewEnd - step : current.viewEnd + step
  return clampViewport(total, current.viewBars, end)
}

/**
 * 单指拖动平移：`dxPx` 为相对手势起点的水平位移（手指右移为正 = 看更早的 K 线）。
 * 以**手势起点窗口**（base）为基准换算，避免逐帧累加带来的漂移；按整根吸附。
 */
export function dragViewport(
  total: number,
  base: ViewportState,
  dxPx: number,
  plotW: number,
): ViewportState {
  const current = clampViewport(total, base.viewBars, base.viewEnd)
  if (!Number.isFinite(dxPx) || !(plotW > 0) || current.viewBars <= 1) return current
  const pxPerBar = plotW / (current.viewBars - 1)
  const delta = Math.round(dxPx / pxPerBar)
  return clampViewport(total, current.viewBars, current.viewEnd - delta)
}

/**
 * 双指捏合缩放：`scale` = 当前指距 / 手势起始指距（>1 = 放大 = 更少根数），
 * `anchorRatio` = 锚点在手势起点窗口内的相对位置（0 = 窗口最左，1 = 最右，通常取两指中点）。
 * 锚点处的那根 K 线缩放前后停在同一横坐标，手感与原生缩放一致；结果同样受 MIN/全量限制。
 */
export function pinchViewport(
  total: number,
  base: ViewportState,
  scale: number,
  anchorRatio: number,
): ViewportState {
  const current = clampViewport(total, base.viewBars, base.viewEnd)
  if (!Number.isFinite(scale) || scale <= 0) return current
  if (Math.abs(scale - 1) < PINCH_DEAD_ZONE) return current
  const nextBars = Math.round(current.viewBars / scale)
  const start = current.viewEnd - current.viewBars + 1
  const ratio = Math.max(0, Math.min(1, Number.isFinite(anchorRatio) ? anchorRatio : 1))
  const anchorIndex = start + ratio * (current.viewBars - 1)
  const nextStart = anchorIndex - ratio * (Math.max(1, nextBars) - 1)
  return clampViewport(total, nextBars, Math.round(nextStart + Math.max(1, nextBars) - 1))
}

/** K 线分片视图：窗口内的 K 线 + 对齐窗口的均线 / MACD（后两者在全量上计算后切片） */
export interface KlineView {
  /** 可见窗口内的 K 线 */
  klines: KlinePoint[]
  /** 均线序列（与 klines 等长，窗口切片） */
  maSeries: Array<Array<number | null>>
  /** 均线周期（与 maSeries 一一对应） */
  maPeriods: number[]
  /** MACD（与 klines 等长，窗口切片；全量不足 MACD 根数时为 null） */
  macd: MacdSeries | null
  /** 是否展示 MACD 面板（按**全量**根数判定：30 根窗口也不该把 MACD 面板藏掉） */
  showMacdPanel: boolean
  /** 全量根数 */
  total: number
  /** 窗口起止（全量下标，闭区间；空数据时 start=0 / end=-1） */
  start: number
  end: number
  /** 窗口是否已贴到最新一根（只有贴住时才展示「最新价」虚线标签） */
  atLatest: boolean
}

/**
 * 取 K 线可见窗口：均线 / MACD 在全量序列上计算再切片，指标预热不被窗口截断。
 * 由组件在每次数据变化 / 缩放 / 平移 / 手势时调用，结果直接喂给各自的绘制模块。
 */
export function buildKlineView(
  all: KlinePoint[],
  viewBars: number,
  viewEnd: number,
  periods: readonly number[] = KLINE_MA_PERIODS,
): KlineView {
  const total = all.length
  const { viewBars: bars, viewEnd: end } = clampViewport(total, viewBars, viewEnd)
  const maPeriods = [...periods]
  if (total <= 0) {
    return {
      klines: [],
      maSeries: maPeriods.map(() => []),
      maPeriods,
      macd: null,
      showMacdPanel: false,
      total: 0,
      start: 0,
      end: -1,
      atLatest: false,
    }
  }
  const start = Math.max(0, end - bars + 1)
  const sliceEnd = end + 1
  const macdFull = hasMacdData(all) ? computeMACD(all) : null
  return {
    klines: all.slice(start, sliceEnd),
    maSeries: maPeriods.map((period) => computeMA(all, period).slice(start, sliceEnd)),
    maPeriods,
    macd: macdFull
      ? {
          dif: macdFull.dif.slice(start, sliceEnd),
          dea: macdFull.dea.slice(start, sliceEnd),
          hist: macdFull.hist.slice(start, sliceEnd),
        }
      : null,
    showMacdPanel: macdFull !== null,
    total,
    start,
    end,
    atLatest: end >= total - 1,
  }
}
