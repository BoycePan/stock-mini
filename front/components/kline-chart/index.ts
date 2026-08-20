import type { KlinePoint } from '../../types/stock'
import { bindTheme, getTheme, unbindTheme } from '../../utils/theme'
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
} from '../../utils/kline'

type CanvasNode = WechatMiniprogram.Canvas
type CanvasCtx = WechatMiniprogram.CanvasRenderingContext.CanvasRenderingContext2D

const UP_COLOR = '#eb514d'
const DOWN_COLOR = '#20a66a'

/** 均线周期与主题配色（浅/深各一套，保证双主题可读） */
const MA_PERIODS = [5, 10, 20] as const
const MA_LABELS = ['MA5', 'MA10', 'MA20'] as const
const MA_COLORS: Record<'light' | 'dark', string[]> = {
  light: ['#f0a020', '#a06ee0', '#4278ed'],
  dark: ['#f5b94a', '#c08ff0', '#6fa3ff'],
}

/**
 * 当日 K 线图（canvas 2d）：
 * - 蜡烛图：影线 + 圆角实体，红涨绿跌（与全局涨跌色一致）
 * - MA5 / MA10 / MA20 均线 + 左上角图例（数值为最新值）
 * - 左侧价格刻度 + 底部日期刻度 + 浅色网格（含纵向时间分隔线）
 * - 下方成交量柱按当根 K 线涨跌分色（红涨、绿跌），左上角标注最大量
 * - 最新价虚线 + 右侧圆角标签（按最后一根涨跌着色）
 * - 点击 / 拖动 canvas 显示十字光标 + 信息框（时间 / 开 / 高 / 低 / 收 / 涨跌幅 / 成交量）
 * - 深浅主题配色跟随 theme
 */
Component({
  properties: {
    klines: { type: Array, value: [] as KlinePoint[] },
    theme: { type: String, value: 'light' },
  },
  observers: {
    'klines, theme': function () {
      this.draw(this.data.klines as KlinePoint[])
    },
  },
  lifetimes: {
    attached() {
      this.setData({ theme: getTheme() })
      bindTheme(this)
    },
    ready() {
      // 等组件就绪后查询画布实际尺寸并绘制（klines 晚于 ready 到达时由 observers 触发）
      this.draw(this.data.klines as KlinePoint[])
    },
    detached() {
      unbindTheme(this)
    },
  },
  methods: {
    draw(klines: KlinePoint[]) {
      this.createSelectorQuery()
        .select('#kline-canvas')
        .fields({ node: true, size: true, rect: true })
        .exec((result) => {
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
          // 数据刷新 / 主题切换重绘时，保留十字光标选中的索引（若仍有效）
          const prev = chartState.get(this)
          const prevActive =
            prev && prev.activeIndex !== null && klines.length > 0
              ? Math.min(prev.activeIndex, klines.length - 1)
              : null
          chartState.set(this, {
            ctx,
            width,
            height,
            klines: klines as KlinePoint[],
            isDark: this.data.theme === 'dark',
            rectLeft: info.left ?? 0,
            padL: 0,
            padR: 8,
            padT: 0,
            padB: 0,
            volH: 0,
            priceH: 0,
            plotW: 0,
            minP: 0,
            maxP: 0,
            activeIndex: prevActive,
          })
          this.render()
        })
    },
    render() {
      const st = chartState.get(this)
      if (!st) return
      const { ctx, width, height } = st
      ctx.clearRect(0, 0, width, height)
      if (!st.klines || st.klines.length === 0) {
        ctx.fillStyle = st.isDark ? '#8a97a8' : '#9aa7b8'
        ctx.font = '12px sans-serif'
        ctx.textAlign = 'center'
        ctx.fillText('暂无K线数据', width / 2, height / 2)
        return
      }
      this.renderChart(st)
      if (st.activeIndex !== null) this.renderCrosshair(st)
    },
    /** 绘制基础图（网格 / 刻度 / 蜡烛 / 均线 / 成交量 / 最新价标签），并把布局参数写回 state */
    renderChart(st: KlineChartState) {
      const { ctx, width, height, klines, isDark } = st
      const gridColor = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(20,32,51,0.08)'
      const textColor = isDark ? '#8a97a8' : '#718096'
      const baseColor = isDark ? 'rgba(255,255,255,0.35)' : 'rgba(20,32,51,0.3)'
      const maColors = isDark ? MA_COLORS.dark : MA_COLORS.light

      const n = klines.length
      const { minP, maxP } = computeKlineRange(klines, 0.06)

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
      st.volH = volH
      st.priceH = priceH
      st.plotW = plotW
      st.minP = minP
      st.maxP = maxP

      const volTop = padT + priceH + 8
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

      // 成交量区：分隔线 + 最大量标注 + 按涨跌分色的柱
      ctx.strokeStyle = gridColor
      ctx.beginPath()
      ctx.moveTo(padL, volTop - 4)
      ctx.lineTo(width - padR, volTop - 4)
      ctx.stroke()
      ctx.fillStyle = textColor
      ctx.textAlign = 'left'
      ctx.fillText(`量 ${formatVolume(volMax)}`, padL + 2, volTop - 10)

      // 同色柱合并为一个 path 批量 fill 提升性能
      const upPath: number[] = []
      const downPath: number[] = []
      for (let i = 0; i < n; i += 1) {
        const k = klines[i]
        if (!k) continue
        const h = volumeBarHeight(k.volume || 0, volMax, volBottom - volTop)
        if (h <= 0) continue
        const x = indexToX(i, n, padL, plotW)
        const bw = Math.max(1, candleW * 0.72)
        if (isUpKline(k)) upPath.push(x - bw / 2, volBottom - h, bw, h)
        else downPath.push(x - bw / 2, volBottom - h, bw, h)
      }
      paintRects(ctx, upPath, 'rgba(235,81,77,0.5)')
      paintRects(ctx, downPath, 'rgba(32,166,106,0.5)')

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

      // 均线 + 左上角图例（最新值）
      const maSeries = MA_PERIODS.map((period) => computeMA(klines, period))
      for (let m = 0; m < maSeries.length; m += 1) {
        const values = maSeries[m]
        if (!values) continue
        ctx.strokeStyle = maColors[m] ?? '#999'
        ctx.lineWidth = 1
        ctx.beginPath()
        let started = false
        for (let i = 0; i < n; i += 1) {
          const v = values[i]
          if (v === null || v === undefined) continue
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
      // 图例：MA5/10/20 + 最新值（左上角）
      const lastIndex = n - 1
      ctx.textAlign = 'left'
      let legendX = padL + 2
      for (let m = 0; m < MA_PERIODS.length; m += 1) {
        const values = maSeries[m]
        const lastVal = values?.[lastIndex]
        const text = `${MA_LABELS[m]}:${lastVal === null || lastVal === undefined ? '--' : lastVal.toFixed(2)}`
        ctx.fillStyle = maColors[m] ?? '#999'
        ctx.fillText(text, legendX, padT - 8)
        legendX += ctx.measureText(text).width + 10
      }

      // 底部日期刻度
      ctx.fillStyle = textColor
      ctx.textAlign = 'center'
      for (const idx of timeIdx) {
        const k = klines[idx]
        if (!k) continue
        ctx.fillText(formatKlineTime(k.time), indexToX(idx, n, padL, plotW), height - 4)
      }

      // 最新价虚线 + 右侧圆角标签
      const last = klines[lastIndex]
      if (last) {
        const lastY = priceToY(last.close, minP, maxP, padT, priceH)
        const color = isUpKline(last) ? UP_COLOR : DOWN_COLOR
        ctx.strokeStyle = baseColor
        ctx.setLineDash([4, 4])
        ctx.beginPath()
        ctx.moveTo(padL, lastY)
        ctx.lineTo(width - padR, lastY)
        ctx.stroke()
        ctx.setLineDash([])
        const label = last.close.toFixed(2)
        ctx.font = '10px sans-serif'
        const labelW = ctx.measureText(label).width + 10
        const tagX = width - padR - labelW
        const tagY = lastY - 9
        ctx.fillStyle = color
        roundRectPath(ctx, tagX, tagY, labelW, 16, 3)
        ctx.fill()
        ctx.fillStyle = '#ffffff'
        ctx.textAlign = 'center'
        ctx.fillText(label, tagX + labelW / 2, tagY + 11.5)
      }
    },
    /** 十字光标 + 信息框（同花顺式） */
    renderCrosshair(st: KlineChartState) {
      const { ctx, width, height, klines, isDark } = st
      const idx = st.activeIndex
      if (idx === null) return
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

      // 收盘价标记点
      ctx.fillStyle = color
      ctx.beginPath()
      ctx.arc(x, y, 3.5, 0, Math.PI * 2)
      ctx.fill()

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
      this.handleTouch(event)
    },
    onTouchMove(event: WechatMiniprogram.TouchEvent) {
      this.handleTouch(event)
    },
    onTouchEnd() {
      const st = chartState.get(this)
      if (st && st.activeIndex !== null) {
        st.activeIndex = null
        this.render()
      }
    },
    handleTouch(event: WechatMiniprogram.TouchEvent) {
      const st = chartState.get(this)
      if (!st || !st.klines || st.klines.length === 0 || st.plotW <= 0) return
      const touch = event.touches?.[0]
      if (!touch) return
      // canvas 触摸事件 touches[0] 运行时自带相对 canvas 的 x（类型声明未包含，这里显式取）
      const touchX = (touch as unknown as { x?: number }).x
      const x = typeof touchX === 'number' ? touchX : (touch.clientX ?? 0) - (st.rectLeft ?? 0)
      const raw = Math.round(((x - st.padL) / st.plotW) * (st.klines.length - 1))
      const next = Math.max(0, Math.min(st.klines.length - 1, raw))
      if (next !== st.activeIndex) {
        st.activeIndex = next
        this.render()
      }
    },
  },
})

interface KlineChartState {
  ctx: CanvasCtx
  width: number
  height: number
  klines: KlinePoint[]
  isDark: boolean
  rectLeft: number
  padL: number
  padR: number
  padT: number
  padB: number
  volH: number
  priceH: number
  plotW: number
  minP: number
  maxP: number
  activeIndex: number | null
}

/** 组件实例 → 画布状态（避免在 data 中放非响应式对象） */
const chartState = new WeakMap<object, KlineChartState>()

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
  ctx.arcTo(x, y, x + w, y, radius)
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
