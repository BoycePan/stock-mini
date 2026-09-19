/**
 * K 线可见窗口（缩放 / 平移）纯函数模块：**不依赖 wx 与具体图表组件**，可单测。
 *
 * 两个图表组件共用同一套窗口模型，保证手感一致：
 * - `packageQuote/components/quote-chart`（行情页 日/周/月/年 K，下方有 − + ‹ › 控件）；
 * - `packageQuote/components/kline-chart`（板块 / 个股详情页的 K 线卡片）。
 *
 * 窗口模型：`{ viewBars, viewEnd }`
 * - `viewBars` = 可见根数（默认 30，永远是整数根，缩放 / 平移都按整根吸附）；
 * - `viewEnd` = 窗口最后一根的**全量下标**（含），窗口左端 = `viewEnd - viewBars + 1`。
 *
 * 改窗口的三条路径（**三条路径的缩放锚点统一为「可见窗口最右侧那根 K 线」**，右端不动）：
 * 1. `‹` / `›` 按钮：**每次移动 1 根**，长按连发（连发节奏见 `panRepeatStep`）；
 * 2. 双指捏合 `scaleViewport`：按指距比例连续缩放；
 * 3. `+` / `−` 按钮：`zoomViewport` 按 0.7 倍率缩放。
 * **单指拖动不改窗口**（只用于查看 K 线数据 / 十字光标），见 utils/chart-gesture.ts。
 *
 * 缩放的上下限（「缩放和放大要有限制」）：
 * - 放大上限：`MIN_VIEW_BARS`（10 根，再放大没有意义且蜡烛会糊）；
 * - 缩小上限：全量根数（一次看完全部历史，不会出现窗口比数据还长的空图）；
 * - 平移上限：窗口左端 ≥ 0、右端 ≤ 总数-1（拖到首尾即停）。
 * 任何路径都经 `clampViewport` 收口，越界一律夹回。
 */

import type { KlinePoint } from '../types/stock'
import { computeMA, computeMACD, hasMacdData, KLINE_MA_PERIODS, type MacdSeries } from './kline'

/** 可见窗口默认根数（默认只画最近 30 根，其余靠手势 / 控件调出） */
export const DEFAULT_VIEW_BARS = 30
/** 可见窗口最小根数（放大到极限） */
export const MIN_VIEW_BARS = 10
/** 点击 − + 缩放的比例：放大 = ×0.7 根数，缩小 = ÷0.7 根数 */
const ZOOM_RATIO = 0.7
/** 双指缩放的死区：指距变化小于该比例时忽略，避免手指抖动把窗口来回抖 */
const PINCH_DEAD_ZONE = 0.02

/** 长按多久开始连发（ms）：小于它算一次轻点（只移动 1 根） */
export const PAN_LONG_PRESS_MS = 400
/** 连发间隔（ms）：约 12 根/秒 起步 */
export const PAN_REPEAT_MS = 80

/**
 * 长按连发的第 tick 次步长（根）：起步 1 根，每 10 个 tick（约 0.8s）加 1 根，
 * 让「按住不放」先精调、再快速滑动，长历史也能几秒内翻到头。
 */
export function panRepeatStep(tick: number): number {
  const n = Math.max(0, Math.floor(Number.isFinite(tick) ? tick : 0))
  return 1 + Math.floor(n / 10)
}

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

/**
 * 左右平移窗口：`bars` = 本次移动根数（默认 1 —— 按钮一次挪一根 K 线，长按连发由调用方累加）。
 */
export function panViewport(
  total: number,
  state: ViewportState,
  dir: 'left' | 'right',
  bars = 1,
): ViewportState {
  const current = clampViewport(total, state.viewBars, state.viewEnd)
  const step = Math.max(1, Math.round(Number.isFinite(bars) ? bars : 1))
  const end = dir === 'left' ? current.viewEnd - step : current.viewEnd + step
  return clampViewport(total, current.viewBars, end)
}

/**
 * 双指捏合缩放：`scale` = 当前指距 / 手势起始指距（>1 = 放大 = 更少根数）。
 * **锚点固定为可见窗口最右侧那根 K 线**（`viewEnd` 不变，只改根数），与 `+` / `−`
 * 按钮同一套手感：无论两指落在画面哪里，缩放时最右侧那根都停在原地，
 * 不会因为两指中点偏左 / 偏右把窗口推离最新一根。结果同样受 MIN / 全量限制。
 */
export function scaleViewport(total: number, state: ViewportState, scale: number): ViewportState {
  const current = clampViewport(total, state.viewBars, state.viewEnd)
  if (!Number.isFinite(scale) || scale <= 0) return current
  if (Math.abs(scale - 1) < PINCH_DEAD_ZONE) return current
  return clampViewport(total, Math.round(current.viewBars / scale), current.viewEnd)
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
  /** 窗口是否已贴到最新一根（贴住后「右移」按钮禁用） */
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
