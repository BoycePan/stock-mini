import type { KlinePoint } from '../../../types/stock'
import { bindTheme, getTheme, unbindTheme } from '../../../utils/theme'
import {
  candleBody,
  computeKlineRange,
  formatKlineTime,
  indexToX,
  isUpKline,
  priceGridLabels,
  priceToY,
  timeLabelIndexes,
  volumeBarHeight,
} from '../../../utils/kline'
import { fitMaLegend } from '../../../utils/kline-legend'
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
  type KlineView,
  type ViewportState,
} from '../../../utils/kline-viewport'

type CanvasNode = WechatMiniprogram.Canvas

/** chart-controls 控件事件：detail.step = 本次移动根数（轻点 1，长按连发逐步加大） */
type ChartControlEvent = WechatMiniprogram.CustomEvent<{ step?: number }>

/** 从控件事件里取移动根数（缺省 1 根，非法值同样按 1 根） */
function stepOf(event: ChartControlEvent): number {
  const step = event?.detail?.step
  return typeof step === 'number' && Number.isFinite(step) && step > 0 ? Math.round(step) : 1
}
type CanvasCtx = WechatMiniprogram.CanvasRenderingContext.CanvasRenderingContext2D

const UP_COLOR = '#eb514d'
const DOWN_COLOR = '#20a66a'

/** 均线配色（浅 / 深各一套，下标与 KLINE_MA_PERIODS 对齐；MA10 = 品红），保证双主题可读 */
const MA_COLORS: Record<'light' | 'dark', string[]> = {
  light: ['#f0a020', '#d1499a', '#a06ee0', '#4278ed', '#0f9b8e'],
  dark: ['#f5b94a', '#ff8fc0', '#c08ff0', '#6fa3ff', '#4fd1c5'],
}

/**
 * 已卸载的组件实例：draw 里的 createSelectorQuery().exec(cb) 回调是异步的，
 * klines / theme 变更（自动刷新、主题切换）发起查询后用户立刻返回上一页时，
 * 回调仍会在已销毁组件上取 ctx、写状态并绘制失效的 canvas 节点，
 * 产生无效绘制与控制台报错，故回调与 render 先判存活后直接返回。
 */
const detachedInstances = new WeakSet<object>()

/**
 * 板块 / 个股详情页的 K 线图（canvas 2d）：
 * - 蜡烛图：影线 + 圆角实体，红涨绿跌（与全局涨跌色一致）；
 * - MA5 / MA10 / MA20 / MA30 / MA60 均线 + 左上角图例（数值取窗口最后一根 / 十字光标选中那根，
 *   图例排版与行情页图表共用 utils/kline-legend.ts，放不下自动降级）；
 * - **可见窗口**：默认只画最近 30 根（整段几百根既卡又糊），三种改窗口方式：
 *   `‹` / `›` 轻点移动 1 根、长按连发（步长逐步加大）、`+` / `−` 缩放、双指捏合缩放（一律以窗口最右侧那根为基准）；
 *   根数被夹在 [MIN_VIEW_BARS=10, 全量] 之间（见 utils/kline-viewport.ts）；
 *   均线在全量 K 线上计算后按窗口切片，所以窗口再小 MA60 也不会失真；
 * - 触摸分工：**单指只用于查看 K 线数据**（按下 / 滑动都只移动十字光标，不会把图拖走），
 *   双指 = 缩放；全部手指抬起后收起十字光标；
 *   十字光标只有虚线十字 + 信息框，**不在交点画实心圆点**（蜡烛已标出该根收盘位置）；
 * - 左侧价格刻度 + 底部日期刻度 + 网格（含纵向时间分隔线）；
 * - 下方成交量柱按当根涨跌分色（同花顺风格），左上角标注窗口内最大量；
 * - 区间极值标注：窗口内最高 / 最低价各一个（短箭头 + 价格文字，箭头指向该根影线端点）；
 *   不画「最新价」常驻标签——它会压住最右侧 K 线，读数交给十字光标触摸查看；
 * - 深浅主题配色跟随 theme（含缩放控件）。
 */
Component({
  properties: {
    /** 全量 K 线（窗口在其上开取，勿在此处裁剪，否则 MA60 / 平移都没有历史可用） */
    klines: { type: Array, value: [] as KlinePoint[] },
    theme: { type: String, value: 'light' },
  },
  data: {
    theme: 'light',
    /** 可见窗口根数（− + 调整） */
    viewBars: DEFAULT_VIEW_BARS,
    /** 窗口最后一根的全量下标（‹ › / 手势调整，-1 = 末尾） */
    viewEnd: -1,
    showControls: false,
    rangeText: '',
    zoomInDisabled: false,
    zoomOutDisabled: false,
    panLeftDisabled: false,
    panRightDisabled: false,
  },
  observers: {
    'klines, theme': function () {
      // 换了 K 线数据（切周期 / 刷新）才把窗口复位到最新一段；主题切换保留用户调好的窗口
      const reset = this.data.klines !== lastKlineSeries.get(this)
      lastKlineSeries.set(this, this.data.klines)
      this.redraw(reset)
    },
  },
  lifetimes: {
    attached() {
      this.setData({ theme: getTheme() })
      bindTheme(this)
    },
    ready() {
      // 等组件就绪后查询画布实际尺寸并绘制（klines 晚于 ready 到达时由 observers 触发）
      lastKlineSeries.set(this, this.data.klines)
      this.redraw(true)
    },
    detached() {
      // 先置销毁标记再解绑主题：在途的 selectorQuery 回调据此短路，不再对已销毁画布绘制
      detachedInstances.add(this)
      canvasStates.delete(this)
      chartStates.delete(this)
      gestureStates.delete(this)
      lastKlineSeries.delete(this)
      unbindTheme(this)
    },
  },
  methods: {
    /**
     * 查询画布尺寸 → 绘制。
     * @param reset 是否把窗口复位到最新一段（换周期时 true；主题切换等 false）
     */
    redraw(reset = true) {
      this.createSelectorQuery()
        .select('#kline-canvas')
        .fields({ node: true, size: true, rect: true })
        .exec((result) => {
          // 组件已卸载：画布节点已失效，取 ctx / 绘制都会报错，直接放弃本次绘制
          if (detachedInstances.has(this)) return
          const info = result?.[0] as
            { node?: CanvasNode; width?: number; height?: number; left?: number } | undefined
          const canvas = info?.node
          if (!canvas) return
          const width = info.width || 320
          const height = info.height || 200
          const dpr = wx.getWindowInfo().pixelRatio || 2
          canvas.width = width * dpr
          canvas.height = height * dpr
          const ctx = canvas.getContext('2d')
          ctx.scale(dpr, dpr)
          canvasStates.set(this, {
            ctx,
            width,
            height,
            rectLeft: info.left ?? 0,
          })
          this.rebuild(reset)
        })
    },
    /**
     * 重建窗口与布局并绘制（不查询画布尺寸；缩放 / 平移 / 手势走这里）。
     * @param reset 是否把窗口复位到最新一段
     * @param viewport 指定窗口（缺省沿用 data 里的窗口并夹紧）
     */
    rebuild(reset: boolean, viewport?: ViewportState) {
      if (detachedInstances.has(this)) return
      const canvasState = canvasStates.get(this)
      if (!canvasState) return
      const klines = (this.data.klines as KlinePoint[]) ?? []
      const total = klines.length
      const next =
        viewport ??
        (reset
          ? defaultViewport(total)
          : clampViewport(total, this.data.viewBars, this.data.viewEnd))
      const view = buildKlineView(klines, next.viewBars, next.viewEnd)

      const showControls = total > MIN_VIEW_BARS
      const bars = view.klines.length
      this.setData({
        viewBars: bars,
        viewEnd: view.end,
        showControls,
        rangeText: showControls ? `${bars} / ${total} 根` : '',
        zoomInDisabled: !showControls || bars <= Math.min(MIN_VIEW_BARS, total),
        zoomOutDisabled: !showControls || bars >= total,
        panLeftDisabled: !showControls || view.start <= 0,
        panRightDisabled: !showControls || view.atLatest,
      })

      const prev = chartStates.get(this)
      // 十字光标只在窗口没变时保留：换窗口后下标指向的是别的 K 线，保留会给出错误读数
      const windowChanged = !!prev && (prev.view.start !== view.start || prev.view.end !== view.end)
      const prevActive = prev && !windowChanged ? prev.activeIndex : null
      chartStates.set(this, {
        view,
        isDark: this.data.theme === 'dark',
        padL: prev?.padL ?? 0,
        padR: prev?.padR ?? 8,
        padT: prev?.padT ?? 0,
        padB: prev?.padB ?? 0,
        volTop: prev?.volTop ?? 0,
        volH: prev?.volH ?? 0,
        priceH: prev?.priceH ?? 0,
        plotW: prev?.plotW ?? 0,
        minP: prev?.minP ?? 0,
        maxP: prev?.maxP ?? 0,
        activeIndex: prevActive !== null && prevActive < bars ? prevActive : null,
      })
      this.render()
    },
    render() {
      // 已卸载（触摸回调 / 主题或数据变更的在途重绘）：不再绘制失效画布
      if (detachedInstances.has(this)) return
      const st = chartStates.get(this)
      const canvasState = canvasStates.get(this)
      if (!st || !canvasState) return
      const { ctx, width, height } = canvasState
      ctx.clearRect(0, 0, width, height)
      if (!st.view.klines.length) {
        ctx.fillStyle = st.isDark ? '#8a97a8' : '#9aa7b8'
        ctx.font = '12px sans-serif'
        ctx.textAlign = 'center'
        ctx.fillText('暂无K线数据', width / 2, height / 2)
        return
      }
      this.renderChart(st, canvasState)
      if (st.activeIndex !== null) this.renderCrosshair(st, canvasState)
    },
    /** 绘制基础图（网格 / 刻度 / 蜡烛 / 均线 / 成交量 / 极值标注），并把布局参数写回 state */
    renderChart(st: KlineChartState, canvasState: CanvasState) {
      const { ctx, width, height } = canvasState
      const isDark = st.isDark
      const gridColor = isDark ? 'rgba(255,255,255,0.12)' : 'rgba(20,32,51,0.12)'
      const textColor = isDark ? '#8a97a8' : '#718096'
      const maColors = isDark ? MA_COLORS.dark : MA_COLORS.light

      // 只画可见窗口内的 K 线（默认 30 根）：均线 / 窗口都在 utils/kline-viewport.ts 里算好
      const klines = st.view.klines
      const n = klines.length
      const { minP, maxP } = computeKlineRange(klines, 0.06, st.view.maSeries)

      // 左侧留白按价格刻度文字宽度自适应
      ctx.font = '10px sans-serif'
      ctx.textAlign = 'left'
      const gridLabels = priceGridLabels(minP, maxP, 5)
      const labelTexts = gridLabels.map((v) => v.toFixed(2))
      let padL = 0
      for (const t of labelTexts) {
        const w = ctx.measureText(t).width
        if (w > padL) padL = w
      }
      padL = Math.min(110, Math.max(48, padL + 14))
      const padR = 8
      const padT = 22
      const padB = 18
      const volH = Math.max(30, Math.round(height * 0.22))
      const priceH = height - padT - padB - volH - 10
      const plotW = width - padL - padR
      const slot = plotW / n
      const candleW = Math.max(1, Math.min(10, slot * 0.68))

      st.padL = padL
      st.padR = padR
      st.padT = padT
      st.padB = padB
      st.volTop = padT + priceH + 8
      st.volH = volH
      st.priceH = priceH
      st.plotW = plotW
      st.minP = minP
      st.maxP = maxP

      const volBottom = height - padB
      const volMax = Math.max(...klines.map((k) => k.volume || 0), 1)

      // 横向网格 + 左侧价格刻度
      ctx.lineWidth = 1
      ctx.textAlign = 'right'
      for (let i = 0; i <= 4; i += 1) {
        const y = padT + (priceH / 4) * i
        ctx.strokeStyle = gridColor
        ctx.beginPath()
        ctx.moveTo(padL, y)
        ctx.lineTo(width - padR, y)
        ctx.stroke()
        ctx.fillStyle = textColor
        ctx.fillText(labelTexts[i] ?? '', padL - 6, y + 3)
      }

      // 纵向网格（时间分隔线，浅色）
      const timeIdx = timeLabelIndexes(n, 5)
      ctx.strokeStyle = gridColor
      for (const idx of timeIdx) {
        const x = indexToX(idx, n, padL, plotW)
        ctx.beginPath()
        ctx.moveTo(x, padT)
        ctx.lineTo(x, volBottom)
        ctx.stroke()
      }

      // 成交量区：分隔线 + 窗口内最大量标注 + 按涨跌分色的柱
      ctx.strokeStyle = gridColor
      ctx.beginPath()
      ctx.moveTo(padL, st.volTop - 4)
      ctx.lineTo(width - padR, st.volTop - 4)
      ctx.stroke()
      ctx.fillStyle = textColor
      ctx.textAlign = 'left'
      ctx.fillText(`量 ${formatVolume(volMax)}`, padL + 2, st.volTop - 10)

      // 同色柱合并为一个 path 批量 fill 提升性能
      const upPath: number[] = []
      const downPath: number[] = []
      for (let i = 0; i < n; i += 1) {
        const k = klines[i]
        if (!k) continue
        const h = volumeBarHeight(k.volume || 0, volMax, volBottom - st.volTop)
        if (h <= 0) continue
        const x = indexToX(i, n, padL, plotW)
        const bw = Math.max(1, candleW * 0.72)
        if (isUpKline(k)) upPath.push(x - bw / 2, volBottom - h, bw, h)
        else downPath.push(x - bw / 2, volBottom - h, bw, h)
      }
      paintRects(ctx, upPath, UP_COLOR)
      paintRects(ctx, downPath, DOWN_COLOR)

      // 蜡烛：影线 + 圆角实体（红涨绿跌）
      for (let i = 0; i < n; i += 1) {
        const k = klines[i]
        if (!k) continue
        const x = indexToX(i, n, padL, plotW)
        const up = isUpKline(k)
        const color = up ? UP_COLOR : DOWN_COLOR
        ctx.strokeStyle = color
        ctx.lineWidth = 1
        // 影线（上下影合一：high → low）
        ctx.beginPath()
        ctx.moveTo(x, priceToY(k.high, minP, maxP, padT, priceH))
        ctx.lineTo(x, priceToY(k.low, minP, maxP, padT, priceH))
        ctx.stroke()
        // 实体
        const yOpen = priceToY(k.open, minP, maxP, padT, priceH)
        const yClose = priceToY(k.close, minP, maxP, padT, priceH)
        const body = candleBody(yOpen, yClose)
        ctx.fillStyle = color
        roundRectPath(ctx, x - candleW / 2, body.top, candleW, body.height, 1)
        ctx.fill()
      }

      // 均线（窗口切片，全量算好）+ 图例（十字光标选中那根 / 否则窗口最后一根）
      const maSeries = st.view.maSeries
      for (let m = 0; m < maSeries.length; m += 1) {
        const values = maSeries[m]
        if (!values) continue
        ctx.strokeStyle = maColors[m] ?? '#999'
        ctx.lineWidth = 1
        ctx.beginPath()
        let started = false
        for (let i = 0; i < n; i += 1) {
          const v = values[i]
          if (v === null || v === undefined || !Number.isFinite(v)) {
            started = false
            continue
          }
          const x = indexToX(i, n, padL, plotW)
          const y = priceToY(v, minP, maxP, padT, priceH)
          if (!started) {
            ctx.moveTo(x, y)
            started = true
          } else {
            ctx.lineTo(x, y)
          }
        }
        if (started) ctx.stroke()
      }
      const legendIndex = st.activeIndex !== null ? st.activeIndex : n - 1
      const legend = fitMaLegend(ctx, {
        periods: st.view.maPeriods,
        padL: padL + 2,
        plotW,
        valueOf: (index) => maSeries[index]?.[legendIndex],
      })
      ctx.textAlign = 'left'
      for (const item of legend.items) {
        ctx.font = legend.font
        ctx.fillStyle = maColors[item.colorIndex] ?? '#999'
        ctx.fillText(item.text, item.x, padT - 8)
      }

      // 底部日期刻度（窗口内的日期）
      ctx.fillStyle = textColor
      ctx.textAlign = 'center'
      for (const idx of timeIdx) {
        const k = klines[idx]
        if (!k) continue
        ctx.fillText(formatKlineTime(k.time), indexToX(idx, n, padL, plotW), height - 4)
      }

      // 极值标注：窗口内最高 / 最低价各一个（短箭头 + 价格文字，箭头指向该根影线端点）。
      // 不画「最新价」虚线标签：常驻标签会压住最右侧 K 线，用户触摸即可查看该根开高低收。
      drawExtremeTags(ctx, klines, n, padL, plotW, padT, priceH, minP, maxP)
    },
    /** 十字光标 + 信息框（同花顺式）；下标是窗口内下标 */
    renderCrosshair(st: KlineChartState, canvasState: CanvasState) {
      const { ctx, width, height } = canvasState
      const isDark = st.isDark
      const idx = st.activeIndex
      if (idx === null) return
      const klines = st.view.klines
      const k = klines[idx]
      if (!k) return
      const n = klines.length
      const { padL, padR, padT, padB, priceH, plotW, minP, maxP } = st
      const color = isUpKline(k) ? UP_COLOR : DOWN_COLOR
      const lineColor = isDark ? 'rgba(255,255,255,0.4)' : 'rgba(20,32,51,0.35)'
      const x = indexToX(idx, n, padL, plotW)
      const y = priceToY(k.close, minP, maxP, padT, priceH)

      // 竖线贯穿价格区 + 成交量区，横线贯穿价格区
      ctx.strokeStyle = lineColor
      ctx.lineWidth = 1
      ctx.setLineDash([4, 3])
      ctx.beginPath()
      ctx.moveTo(x, padT)
      ctx.lineTo(x, height - padB)
      ctx.stroke()
      ctx.beginPath()
      ctx.moveTo(padL, y)
      ctx.lineTo(padL + plotW, y)
      ctx.stroke()
      ctx.setLineDash([])

      // 不在交点画实心圆点：K 线蜡烛本身已标出该根收盘位置，再叠一个点只是噪声
      // （分时图保留圆点——走势线上没有蜡烛，圆点用来定位当前读数）

      // 信息框内容
      const prevClose = idx > 0 ? klines[idx - 1]?.close : undefined
      const hasPrev = prevClose !== undefined && Number.isFinite(prevClose) && prevClose !== 0
      const change = hasPrev ? k.close - (prevClose as number) : null
      const pct = hasPrev ? ((change as number) / (prevClose as number)) * 100 : null
      const rows: Array<{ text: string; color: string }> = []
      rows.push({ text: `时间 ${k.time}`, color: isDark ? '#c3cede' : '#66758a' })
      rows.push({ text: `开 ${k.open.toFixed(2)}`, color: textRowColor(isDark) })
      rows.push({ text: `高 ${k.high.toFixed(2)}`, color: textRowColor(isDark) })
      rows.push({ text: `低 ${k.low.toFixed(2)}`, color: textRowColor(isDark) })
      rows.push({ text: `收 ${k.close.toFixed(2)}`, color })
      if (change !== null && pct !== null) {
        const sign = change >= 0 ? '+' : ''
        rows.push({
          text: `涨跌 ${sign}${change.toFixed(2)}  ${sign}${pct.toFixed(2)}%`,
          color: change >= 0 ? UP_COLOR : DOWN_COLOR,
        })
      }
      rows.push({
        text: `成交量 ${formatVolume(k.volume || 0)}`,
        color: isDark ? '#c3cede' : '#66758a',
      })

      // 信息框位置：优先十字线右侧，越界翻到左侧；纵向贴顶
      const lineHeight = 15
      ctx.font = '10px sans-serif'
      ctx.textAlign = 'left'
      let boxW = 0
      for (const row of rows) {
        const w = ctx.measureText(row.text).width
        if (w > boxW) boxW = w
      }
      boxW += 14
      const boxH = rows.length * lineHeight + 8
      let boxX = x + 10
      if (boxX + boxW > width - padR) boxX = x - 10 - boxW
      let boxY = padT + 4
      if (boxY + boxH > height - padB) boxY = height - padB - boxH

      ctx.fillStyle = isDark ? 'rgba(20,32,51,0.92)' : 'rgba(255,255,255,0.94)'
      ctx.strokeStyle = isDark ? 'rgba(255,255,255,0.2)' : 'rgba(20,32,51,0.15)'
      roundRectPath(ctx, boxX, boxY, boxW, boxH, 4)
      ctx.fill()
      ctx.stroke()

      rows.forEach((row, i) => {
        ctx.fillStyle = row.color
        ctx.fillText(row.text, boxX + 7, boxY + 12 + i * lineHeight)
      })
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
    /** 手势识别所需的当前配置（窗口随缩放 / 平移实时变化） */
    gestureConfig(): GestureConfig {
      const canvasState = canvasStates.get(this)
      const total = ((this.data.klines as KlinePoint[]) ?? []).length
      return {
        zoomable: true,
        total,
        viewport: clampViewport(total, this.data.viewBars, this.data.viewEnd),
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
    /** 应用新窗口：与当前窗口一致时直接返回，避免无谓重绘 */
    applyViewportState(next: ViewportState): void {
      const total = ((this.data.klines as KlinePoint[]) ?? []).length
      const current = clampViewport(total, this.data.viewBars, this.data.viewEnd)
      if (next.viewBars === current.viewBars && next.viewEnd === current.viewEnd) return
      this.rebuild(false, next)
    },
    /** 控件：放大（更少根数） */
    onZoomIn() {
      this.stepViewport('zoom', 'in')
    },
    /** 控件：缩小（更多根数） */
    onZoomOut() {
      this.stepViewport('zoom', 'out')
    },
    /** 控件：左移（轻点 1 根，长按连发按 detail.step 批量移动） */
    onPanLeft(event: ChartControlEvent) {
      this.stepViewport('pan', 'left', stepOf(event))
    },
    /** 控件：右移（轻点 1 根，长按连发按 detail.step 批量移动） */
    onPanRight(event: ChartControlEvent) {
      this.stepViewport('pan', 'right', stepOf(event))
    },
    stepViewport(kind: 'zoom' | 'pan', dir: 'in' | 'out' | 'left' | 'right', step = 1) {
      const total = ((this.data.klines as KlinePoint[]) ?? []).length
      if (total <= MIN_VIEW_BARS) return
      const current: ViewportState = { viewBars: this.data.viewBars, viewEnd: this.data.viewEnd }
      this.applyViewportState(
        kind === 'zoom'
          ? zoomViewport(total, current, dir === 'in' ? 'in' : 'out')
          : panViewport(total, current, dir === 'left' ? 'left' : 'right', step),
      )
    },
    /** 十字光标：命中窗口内的最近一根并重绘 */
    moveCrosshair(x: number) {
      const st = chartStates.get(this)
      if (!st || st.plotW <= 0) return
      const n = st.view.klines.length
      if (n < 1) return
      const raw = Math.round(((x - st.padL) / st.plotW) * (n - 1))
      const next = Math.max(0, Math.min(n - 1, raw))
      if (next === st.activeIndex) return
      st.activeIndex = next
      this.render()
    },
    clearCrosshair() {
      const st = chartStates.get(this)
      if (!st || st.activeIndex === null) return
      st.activeIndex = null
      this.render()
    },
  },
})

/** 画布状态：尺寸 / 上下文 / 命中偏移 */
interface CanvasState {
  ctx: CanvasCtx
  width: number
  height: number
  rectLeft: number
}

/** 绘制状态：可见窗口 + 上一次算出的布局参数（十字光标复用） */
interface KlineChartState {
  view: KlineView
  isDark: boolean
  padL: number
  padR: number
  padT: number
  padB: number
  volTop: number
  volH: number
  priceH: number
  plotW: number
  minP: number
  maxP: number
  /** 十字光标选中的窗口内下标 */
  activeIndex: number | null
}

/** 组件实例 → 画布 / 绘制 / 手势状态（避免在 data 中放非响应式对象） */
const canvasStates = new WeakMap<object, CanvasState>()
const chartStates = new WeakMap<object, KlineChartState>()
const gestureStates = new WeakMap<object, GestureState | null>()

/** 组件实例 → 上一次的 K 线数组引用（判断是否换了周期，决定要不要复位窗口） */
const lastKlineSeries = new WeakMap<object, unknown>()

/**
 * 区间极值标注：把可见窗口内的最高价 / 最低价用短箭头 + 价格文字标出来
 * （与行情页 K 线图 packageQuote/components/quote-chart/draw.ts 同一套画法）。
 * 不再画「最新价」常驻标签：它会压住最右侧 K 线，用户触摸即可查看该根开高低收。
 */
function drawExtremeTags(
  ctx: CanvasCtx,
  klines: KlinePoint[],
  n: number,
  padL: number,
  plotW: number,
  padT: number,
  priceH: number,
  minP: number,
  maxP: number,
): void {
  let hi = -1
  let lo = -1
  let hiVal = -Infinity
  let loVal = Infinity
  for (let i = 0; i < n; i += 1) {
    const k = klines[i]
    if (!k) continue
    if (k.high > hiVal) {
      hiVal = k.high
      hi = i
    }
    if (k.low < loVal) {
      loVal = k.low
      lo = i
    }
  }
  const highBar = hi >= 0 ? klines[hi] : undefined
  const lowBar = lo >= 0 ? klines[lo] : undefined
  if (highBar) {
    drawExtremeTag(
      ctx,
      highBar.high.toFixed(2),
      indexToX(hi, n, padL, plotW),
      priceToY(highBar.high, minP, maxP, padT, priceH),
      padL,
      padL + plotW,
      UP_COLOR,
    )
  }
  if (lowBar) {
    drawExtremeTag(
      ctx,
      lowBar.low.toFixed(2),
      indexToX(lo, n, padL, plotW),
      priceToY(lowBar.low, minP, maxP, padT, priceH),
      padL,
      padL + plotW,
      DOWN_COLOR,
    )
  }
}

/**
 * 单个极值标签：短箭头（尖端指向该根的最高 / 最低价）+ 价格文字，横向贴在极值点一侧。
 * 标签一律摆向**空间更大的一侧**（极值靠左 → 标签在右，靠右 → 标签在左），
 * 这样箭头顺手指向绘图区内部，文字也不会被画布边缘裁掉。
 */
function drawExtremeTag(
  ctx: CanvasCtx,
  text: string,
  x: number,
  y: number,
  plotL: number,
  plotR: number,
  color: string,
): void {
  ctx.font = '10px sans-serif'
  const arrowW = 5
  const gap = 2
  const toLeft = x - plotL >= plotR - x
  const dir = toLeft ? -1 : 1
  const baseX = x + dir * (2 + arrowW)

  ctx.fillStyle = color
  ctx.beginPath()
  ctx.moveTo(x + dir * 2, y)
  ctx.lineTo(baseX, y - 3.5)
  ctx.lineTo(baseX, y + 3.5)
  ctx.closePath()
  ctx.fill()

  ctx.textAlign = toLeft ? 'right' : 'left'
  ctx.fillText(text, baseX + dir * gap, y + 3.5)
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
  ctx.arcTo(x + w, y + h, x, y, radius)
  ctx.arcTo(x + w, y, x + w, y, radius)
  ctx.closePath()
}

/** 信息框普通文字色（主题感知） */
function textRowColor(isDark: boolean): string {
  return isDark ? '#c3cede' : '#66758a'
}

/** 成交量简写 */
function formatVolume(volume: number): string {
  if (!Number.isFinite(volume)) return '--'
  if (volume >= 100000000) return `${(volume / 100000000).toFixed(2)}亿`
  if (volume >= 10000) return `${(volume / 10000).toFixed(2)}万`
  return String(volume)
}
