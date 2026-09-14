import type { KlinePoint, MinutePoint } from '../../../types/stock'
import { bindTheme, getTheme, unbindTheme } from '../../../utils/theme'
import type { MinuteSessionKind } from '../../../utils/minute-session'
import {
  buildQuoteChartLayout,
  hitTestIndex,
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
 *   本文件只负责画布生命周期（查询尺寸、dpr、主题、触摸命中、销毁保护）；
 * - 三块面板：价格 → 成交量 → MACD；成交量与 MACD 无数据时整块隐藏（价格面板自动占满），
 *   即「有则展示、没有就不展示」；
 * - 画布高度随模式切换（wxss 按 mode 类名给定），K 线模式更高以容纳 MACD 面板；
 * - 十字光标：竖线贯穿三块面板、横线在价格面板，信息框按模式给出不同字段。
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
    /** K 线数据（日/周/月/年模式） */
    klines: { type: Array, value: [] as KlinePoint[] },
    theme: { type: String, value: 'light' },
  },
  observers: {
    'mode, points, preClose, session, klines, theme': function () {
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
      chartState.delete(this)
      unbindTheme(this)
    },
  },
  methods: {
    /** 查询画布尺寸 → 布局 → 绘制（保留仍有效的十字光标选中下标） */
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

          const prev = chartState.get(this)
          const prevActive = prev?.data.activeIndex ?? null
          const data: QuoteChartData = {
            mode: this.data.mode as QuoteChartMode,
            width,
            height,
            isDark: this.data.theme === 'dark',
            points: (this.data.points as MinutePoint[]) ?? [],
            preClose: (this.data.preClose as number) ?? 0,
            session: this.data.session as MinuteSessionKind,
            klines: (this.data.klines as KlinePoint[]) ?? [],
            activeIndex: null,
          }
          const layout = buildQuoteChartLayout(data, ctx)
          data.activeIndex = prevActive !== null && prevActive < layout.n ? prevActive : null
          chartState.set(this, { ctx, layout, data, rectLeft: info.left ?? 0 })
          this.paint()
        })
    },
    /** 按当前状态重绘（含十字光标） */
    paint() {
      if (destroyedInstances.has(this)) return
      const st = chartState.get(this)
      if (!st) return
      renderChart(st.ctx, st.data, st.layout)
      if (st.data.activeIndex !== null) renderCrosshair(st.ctx, st.data, st.layout)
    },
    onTouchStart(event: WechatMiniprogram.TouchEvent) {
      this.handleTouch(event)
    },
    onTouchMove(event: WechatMiniprogram.TouchEvent) {
      this.handleTouch(event)
    },
    onTouchEnd() {
      const st = chartState.get(this)
      if (!st || st.data.activeIndex === null) return
      st.data.activeIndex = null
      this.paint()
    },
    handleTouch(event: WechatMiniprogram.TouchEvent) {
      const st = chartState.get(this)
      if (!st) return
      const touch = event.touches?.[0]
      if (!touch) return
      // canvas 触摸事件 touches[0] 运行时自带相对 canvas 的 x（类型声明未包含，这里显式取）
      const touchX = (touch as unknown as { x?: number }).x
      const x = typeof touchX === 'number' ? touchX : (touch.clientX ?? 0) - (st.rectLeft ?? 0)
      const next = hitTestIndex(st.layout, x)
      if (next === null || next === st.data.activeIndex) return
      st.data.activeIndex = next
      this.paint()
    },
  },
})

interface ChartState {
  ctx: ChartCtx
  layout: QuoteChartLayout
  data: QuoteChartData
  rectLeft: number
}

/** 组件实例 → 画布状态（避免把非响应式对象放进 data） */
const chartState = new WeakMap<object, ChartState>()

/**
 * 已销毁实例：draw 的 createSelectorQuery().exec 回调是异步的，
 * 用户切 TAB / 返回上一页时组件可能已销毁，回调需据此短路。
 */
const destroyedInstances = new WeakSet<object>()
