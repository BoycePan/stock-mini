import type { KlinePoint, MinutePoint } from '../../../types/stock'
import { bindTheme, getTheme, unbindTheme } from '../../../utils/theme'
import type { MinuteSessionKind } from '../../../utils/minute-session'
import {
  beginGesture,
  endGesture,
  moveGesture,
  type GestureAction,
  type GestureConfig,
  type GestureState,
} from '../../../utils/chart-gesture'
import {
  buildKlineView,
  clampViewport,
  DEFAULT_VIEW_BARS,
  defaultViewport,
  MIN_VIEW_BARS,
  panViewport,
  zoomViewport,
  type ViewportState,
} from '../../../utils/kline-viewport'
import {
  buildQuoteChartLayout,
  hitTestIndex,
  isKlineMode,
  renderChart,
  renderCrosshair,
  type ChartCtx,
  type QuoteChartData,
  type QuoteChartLayout,
  type QuoteChartMode,
} from './draw'

type CanvasNode = WechatMiniprogram.Canvas

/**
 * 行情图表组件（canvas 2d）：分时 / 五日 / 日K / 周K / 月K / 年K 六种模式共用一张画布。
 *
 * - 绘制逻辑全在 ./draw.ts（纯函数、不依赖 wx，可单测与浏览器预览）；
 *   本文件只负责画布生命周期（查询尺寸、dpr、主题、触摸命中、缩放/平移控件、销毁保护）；
 * - 三块面板：价格 → 成交量 → MACD；成交量与 MACD 无数据时整块隐藏（价格面板自动占满），
 *   即「有则展示、没有就不展示」；
 * - 画布高度随模式切换（wxss 按 mode 类名给定），K 线模式更高以容纳 MACD 面板；
 * - 十字光标：竖线贯穿三块面板、横线在价格面板，信息框按模式给出不同字段；
 * - **K 线可见窗口**：默认只画最近 30 根（整段几百根既卡又糊），三种改窗口的方式：
 *   下方 − + ‹ › 按钮、单指左右拖动平移、双指捏合缩放（锚点为两指中点）；
 *   窗口根数被夹在 [MIN_VIEW_BARS=10, 全量] 之间（见 utils/kline-viewport.ts）；
 *   均线与 MACD 仍在全量数据上计算后按窗口切片，窗口再小 MA60 / MACD 预热也不会失真。
 * - 触摸分工：单指轻点 / 小幅移动 = 十字光标；单指横向拖动 = 平移（超过阈值后接管，
 *   十字光标随之收起）；双指 = 缩放。分时 / 五日没有窗口，触摸行为保持原样（只有十字光标）。
 */
Component({
  properties: {
    /** 图表模式：minute / fiveDay / day / week / month / year */
    mode: { type: String, value: 'minute' },
    /** 分时 / 五日数据点 */
    points: { type: Array, value: [] as MinutePoint[] },
    /** 分时涨跌基准（昨收 / 昨结算） */
    preClose: { type: Number, value: 0 },
    /** 分时交易时段模型（分时模式按真实时钟铺点） */
    session: { type: String, value: 'continuous' },
    /** K 线数据（日/周/月/年模式，全量：缩放 / 平移在其上开窗） */
    klines: { type: Array, value: [] as KlinePoint[] },
    theme: { type: String, value: 'light' },
  },
  data: {
    theme: 'light',
    /** 可见窗口根数（K 线模式；由 − + 缩放调整） */
    viewBars: DEFAULT_VIEW_BARS,
    /** 可见窗口最后一根的全量下标（K 线模式；由 ‹ › 平移调整，-1 = 末尾） */
    viewEnd: -1,
    /** 是否展示 − + ‹ › 控件（仅 K 线周期且根数足够时） */
    showControls: false,
    /** 窗口文案（例：30 / 320 根） */
    rangeText: '',
    zoomInDisabled: false,
    zoomOutDisabled: false,
    panLeftDisabled: false,
    panRightDisabled: false,
  },
  observers: {
    'mode, points, preClose, session, klines, theme': function () {
      // 数据/主题变化：重新查询画布尺寸，并把窗口复位到最新一段（DEFAULT_VIEW_BARS 根）
      this.redraw()
    },
  },
  lifetimes: {
    attached() {
      this.setData({ theme: getTheme() })
      bindTheme(this)
    },
    ready() {
      // 组件就绪后查询画布实际尺寸并绘制（数据晚于 ready 到达时由 observers 触发）
      this.redraw()
    },
    detached() {
      // draw 的 exec 回调异步：先置销毁标记，回调据此短路，避免对已销毁画布绘制
      destroyedInstances.add(this)
      canvasStates.delete(this)
      chartStates.delete(this)
      gestureStates.delete(this)
      lastKlineSeries.delete(this)
      unbindTheme(this)
    },
  },
  methods: {
    /** 查询画布尺寸 → 复位窗口 → 布局 → 绘制 */
    redraw() {
      this.createSelectorQuery()
        .select('#quote-chart-canvas')
        .fields({ node: true, size: true, rect: true })
        .exec((result) => {
          if (destroyedInstances.has(this)) return
          const info = result?.[0] as
            { node?: CanvasNode; width?: number; height?: number; left?: number } | undefined
          const canvas = info?.node
          if (!canvas) return
          const width = info.width || 320
          const height = info.height || 240
          const dpr = wx.getWindowInfo().pixelRatio || 2
          canvas.width = width * dpr
          canvas.height = height * dpr
          const ctx = canvas.getContext('2d') as unknown as ChartCtx
          ctx.scale(dpr, dpr)

          const total = ((this.data.klines as KlinePoint[]) ?? []).length
          // 只有 K 线数据换了（切周期 / 下拉刷新）才复位到最新 30 根；
          // 主题切换、分时轮询等其他 observer 触发不打扰用户已经调好的窗口
          const reset = this.data.klines !== lastKlineSeries.get(this)
          lastKlineSeries.set(this, this.data.klines)
          const viewport = reset
            ? defaultViewport(total)
            : clampViewport(total, this.data.viewBars, this.data.viewEnd)
          canvasStates.set(this, {
            ctx,
            width,
            height,
            rectLeft: info.left ?? 0,
            viewStart: 0,
            viewEnd: -1,
          })
          this.rebuild(viewport, false)
        })
    },
    /**
     * 按当前属性 + 窗口状态重建布局并重绘（不重新查询画布尺寸，缩放 / 平移走这里）。
     * @param viewport 目标窗口（缺省沿用 data 里的窗口并夹紧）
     * @param keepActive 是否保留十字光标选中下标（窗口变化时坐标含义已变 → 传 false）
     */
    rebuild(viewport?: ViewportState, keepActive = true) {
      if (destroyedInstances.has(this)) return
      const canvasState = canvasStates.get(this)
      if (!canvasState) return
      const mode = this.data.mode as QuoteChartMode
      const klines = (this.data.klines as KlinePoint[]) ?? []
      const isKline = isKlineMode(mode)
      const total = klines.length
      const next = viewport ?? clampViewport(total, this.data.viewBars, this.data.viewEnd)
      const view = isKline ? buildKlineView(klines, next.viewBars, next.viewEnd) : null
      const windowChanged = view
        ? view.start !== canvasState.viewStart || view.end !== canvasState.viewEnd
        : false

      // 控件状态：只有 K 线周期、且根数超过最小窗口时才需要缩放 / 平移
      const showControls = isKline && total > MIN_VIEW_BARS
      const minBars = Math.min(MIN_VIEW_BARS, total)
      const bars = view ? view.klines.length : 0
      this.setData({
        viewBars: view ? view.klines.length : next.viewBars,
        viewEnd: view ? view.end : next.viewEnd,
        showControls,
        rangeText: showControls ? `${bars} / ${total} 根` : '',
        zoomInDisabled: !showControls || bars <= minBars,
        zoomOutDisabled: !showControls || bars >= total,
        panLeftDisabled: !showControls || (view ? view.start <= 0 : true),
        // 「右移」到最后一根即不可再右移；窗口已贴右端时禁用
        panRightDisabled: !showControls || (view ? view.end >= total - 1 : true),
      })

      const base: QuoteChartData = {
        mode,
        width: canvasState.width,
        height: canvasState.height,
        isDark: this.data.theme === 'dark',
        points: (this.data.points as MinutePoint[]) ?? [],
        preClose: (this.data.preClose as number) ?? 0,
        session: this.data.session as MinuteSessionKind,
        klines: view ? view.klines : klines,
        activeIndex: null,
        ...(view
          ? {
              maSeries: view.maSeries,
              maPeriods: view.maPeriods,
              macd: view.macd,
              showMacdPanel: view.showMacdPanel,
            }
          : {}),
      }
      const prevActive =
        keepActive && !windowChanged ? (chartStates.get(this)?.data.activeIndex ?? null) : null
      const layout = buildQuoteChartLayout(base, canvasState.ctx)
      base.activeIndex = prevActive !== null && prevActive < layout.n ? prevActive : null
      chartStates.set(this, { layout, data: base })
      canvasState.viewStart = view ? view.start : 0
      canvasState.viewEnd = view ? view.end : -1
      this.paint()
    },
    /** 按当前状态重绘（含十字光标） */
    paint() {
      if (destroyedInstances.has(this)) return
      const canvasState = canvasStates.get(this)
      const chart = chartStates.get(this)
      if (!canvasState || !chart) return
      renderChart(canvasState.ctx, chart.data, chart.layout)
      if (chart.data.activeIndex !== null) {
        renderCrosshair(canvasState.ctx, chart.data, chart.layout)
      }
    },
    /** 放大（更少根数，看得更细） */
    onZoomIn() {
      this.applyViewport('zoom', 'in')
    },
    /** 缩小（更多根数） */
    onZoomOut() {
      this.applyViewport('zoom', 'out')
    },
    /** 左移（回看更早的 K 线） */
    onPanLeft() {
      this.applyViewport('pan', 'left')
    },
    /** 右移（看更新的 K 线） */
    onPanRight() {
      this.applyViewport('pan', 'right')
    },
    /**
     * 缩放 / 平移统一入口：K 线模式下把窗口推进一格并重建布局。
     * 窗口变化会清掉十字光标（选中下标是窗口内下标，换窗口后含义已变）。
     */
    applyViewport(kind: 'zoom' | 'pan', dir: 'in' | 'out' | 'left' | 'right') {
      if (!isKlineMode(this.data.mode as QuoteChartMode)) return
      const total = ((this.data.klines as KlinePoint[]) ?? []).length
      if (total <= MIN_VIEW_BARS) return
      const current: ViewportState = { viewBars: this.data.viewBars, viewEnd: this.data.viewEnd }
      const next =
        kind === 'zoom'
          ? zoomViewport(total, current, dir === 'in' ? 'in' : 'out')
          : panViewport(total, current, dir === 'left' ? 'left' : 'right')
      this.applyViewportState(next)
    },
    onTouchStart(event: WechatMiniprogram.TouchEvent) {
      const update = beginGesture(event.touches ?? [], this.gestureConfig())
      gestureStates.set(this, update.state)
      this.runGestureAction(update.action)
    },
    onTouchMove(event: WechatMiniprogram.TouchEvent) {
      const state = gestureStates.get(this)
      if (!state) return
      const update = moveGesture(state, event.touches ?? [], this.gestureConfig())
      gestureStates.set(this, update.state)
      this.runGestureAction(update.action)
    },
    onTouchEnd(event: WechatMiniprogram.TouchEvent) {
      const update = endGesture(event.touches?.length ?? 0)
      gestureStates.set(this, update.state)
      this.runGestureAction(update.action)
    },
    /** 手势识别所需的当前配置（窗口 / 绘图区几何随缩放与平移实时变化） */
    gestureConfig(): GestureConfig {
      const chart = chartStates.get(this)
      const canvasState = canvasStates.get(this)
      const layout = chart?.layout
      return {
        zoomable: isKlineMode(this.data.mode as QuoteChartMode),
        total: this.klineTotal(),
        viewport: this.currentViewport(),
        padL: layout?.padL ?? 0,
        plotW: layout?.plotW ?? 0,
        rectLeft: canvasState?.rectLeft ?? 0,
      }
    },
    /** 执行手势动作：十字光标 / 收起 / 新窗口 */
    runGestureAction(action: GestureAction | null) {
      if (!action) return
      if (action.kind === 'crosshair') {
        this.moveCrosshair(action.x)
        return
      }
      if (action.kind === 'clear') {
        this.clearCrosshair()
        return
      }
      this.applyViewportState(action.viewport)
    },
    /** 当前周期是否可缩放 / 平移（仅 K 线且根数超过最小窗口） */
    canPanZoom(): boolean {
      return isKlineMode(this.data.mode as QuoteChartMode) && this.klineTotal() > MIN_VIEW_BARS
    },
    klineTotal(): number {
      return ((this.data.klines as KlinePoint[]) ?? []).length
    },
    currentViewport(): ViewportState {
      return clampViewport(this.klineTotal(), this.data.viewBars, this.data.viewEnd)
    },
    /** 应用新窗口：与当前窗口一致时直接返回，避免无谓重绘 */
    applyViewportState(next: ViewportState): void {
      const current = this.currentViewport()
      if (next.viewBars === current.viewBars && next.viewEnd === current.viewEnd) return
      this.rebuild(next, false)
    },
    /** 十字光标：命中窗口内的最近一根并重绘 */
    moveCrosshair(x: number) {
      const chart = chartStates.get(this)
      if (!chart) return
      const next = hitTestIndex(chart.layout, x)
      if (next === null || next === chart.data.activeIndex) return
      chart.data.activeIndex = next
      this.paint()
    },
    clearCrosshair() {
      const chart = chartStates.get(this)
      if (!chart || chart.data.activeIndex === null) return
      chart.data.activeIndex = null
      this.paint()
    },
  },
})

/** 画布状态：尺寸 / 上下文 / 命中偏移（crosshair 与绘制共用） */
interface CanvasState {
  ctx: ChartCtx
  width: number
  height: number
  rectLeft: number
  /** 当前可见窗口的全量起止下标（非 K 线模式 0 / -1），用于判断窗口是否变化 */
  viewStart: number
  viewEnd: number
}

/** 绘制状态：布局与数据快照（缩放 / 平移时整体替换） */
interface ChartState {
  layout: QuoteChartLayout
  data: QuoteChartData
}

/** 组件实例 → 画布状态（避免把非响应式对象放进 data） */
const canvasStates = new WeakMap<object, CanvasState>()
const chartStates = new WeakMap<object, ChartState>()
/** 组件实例 → 当前手势状态（单指拖动平移 / 双指捏合缩放） */
const gestureStates = new WeakMap<object, GestureState | null>()

/** 组件实例 → 上一次的 K 线数组引用（判断是否换了周期，决定要不要复位窗口） */
const lastKlineSeries = new WeakMap<object, unknown>()

/**
 * 已销毁实例：draw 的 createSelectorQuery().exec 回调是异步的，
 * 用户切 TAB / 返回上一页时组件可能已销毁，回调需据此短路。
 */
const destroyedInstances = new WeakSet<object>()
