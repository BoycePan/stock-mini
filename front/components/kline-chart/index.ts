import type { KlinePoint } from '../../types/stock'
import { bindTheme, getTheme, unbindTheme } from '../../utils/theme'

type CanvasNode = WechatMiniprogram.Canvas
type CanvasCtx = WechatMiniprogram.CanvasRenderingContext.CanvasRenderingContext2D

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
        .fields({ node: true, size: true })
        .exec((result) => {
          const info = result?.[0] as
            { node?: CanvasNode; width?: number; height?: number } | undefined
          const canvas = info?.node
          if (!canvas) return
          const width = info.width || 320
          const height = info.height || 200
          const dpr = wx.getWindowInfo().pixelRatio || 2
          canvas.width = width * dpr
          canvas.height = height * dpr
          const ctx = canvas.getContext('2d')
          ctx.scale(dpr, dpr)
          ctx.clearRect(0, 0, width, height)

          const isDark = this.data.theme === 'dark'
          if (!klines || !klines.length) {
            ctx.fillStyle = isDark ? '#8a97a8' : '#9aa7b8'
            ctx.font = '12px sans-serif'
            ctx.textAlign = 'center'
            ctx.fillText('暂无K线数据', width / 2, height / 2)
            return
          }
          this.renderChart(ctx, width, height, klines, isDark)
        })
    },
    renderChart(
      ctx: CanvasCtx,
      width: number,
      height: number,
      klines: KlinePoint[],
      isDark: boolean,
    ) {
      const upColor = '#F04B45'
      const downColor = '#2DB653'
      const gridColor = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(20,32,51,0.08)'
      const textColor = isDark ? '#8a97a8' : '#718096'

      const padL = 10
      const padR = 10
      const padT = 18
      const padB = 10
      const volH = Math.max(28, Math.round(height * 0.22))
      const priceH = height - padT - padB - volH - 8

      const n = klines.length
      const highs = klines.map((k) => k.high)
      const lows = klines.map((k) => k.low)
      let min = Math.min(...lows)
      let max = Math.max(...highs)
      if (!Number.isFinite(min) || !Number.isFinite(max)) {
        min = 0
        max = 1
      }
      if (min === max) {
        min -= 1
        max += 1
      }
      const range = max - min
      const minP = min - range * 0.08
      const maxP = max + range * 0.08

      const plotW = width - padL - padR
      const slot = plotW / n
      const candleW = Math.max(1, Math.min(9, slot * 0.6))
      const priceY = (p: number) => padT + ((maxP - p) / (maxP - minP)) * priceH
      const volMax = Math.max(...klines.map((k) => k.volume || 0), 1)
      const volTop = padT + priceH + 8
      const volY = (v: number) => volTop + (1 - (v || 0) / volMax) * volH

      // 横向网格与价格刻度
      ctx.strokeStyle = gridColor
      ctx.lineWidth = 1
      ctx.fillStyle = textColor
      ctx.font = '10px sans-serif'
      ctx.textAlign = 'left'
      for (let i = 0; i <= 4; i += 1) {
        const y = padT + (priceH / 4) * i
        ctx.beginPath()
        ctx.moveTo(padL, y)
        ctx.lineTo(width - padR, y)
        ctx.stroke()
        const price = maxP - ((maxP - minP) / 4) * i
        ctx.fillText(price.toFixed(2), padL + 2, y - 4)
      }

      // K 线与成交量
      for (let i = 0; i < n; i += 1) {
        const k = klines[i]
        if (!k) continue
        const x = padL + slot * i + slot / 2
        const up = k.close >= k.open
        const color = up ? upColor : downColor
        ctx.strokeStyle = color
        ctx.fillStyle = color

        // 影线
        ctx.beginPath()
        ctx.moveTo(x, priceY(k.high))
        ctx.lineTo(x, priceY(k.low))
        ctx.stroke()

        // 实体
        const yOpen = priceY(k.open)
        const yClose = priceY(k.close)
        const top = Math.min(yOpen, yClose)
        const bodyH = Math.max(1, Math.abs(yOpen - yClose))
        ctx.fillRect(x - candleW / 2, top, candleW, bodyH)

        // 成交量
        const vTop = volY(k.volume || 0)
        ctx.globalAlpha = 0.55
        ctx.fillRect(x - candleW / 2, vTop, candleW, volTop + volH - vTop)
        ctx.globalAlpha = 1
      }

      // 最新价虚线 + 标签
      const last = klines[n - 1]
      if (last) {
        const lastY = priceY(last.close)
        ctx.strokeStyle = isDark ? 'rgba(255,255,255,0.35)' : 'rgba(20,32,51,0.3)'
        ctx.setLineDash([4, 4])
        ctx.beginPath()
        ctx.moveTo(padL, lastY)
        ctx.lineTo(width - padR, lastY)
        ctx.stroke()
        ctx.setLineDash([])
        ctx.fillStyle = last.close >= last.open ? upColor : downColor
        const label = last.close.toFixed(2)
        const labelW = ctx.measureText(label).width + 8
        ctx.fillStyle = last.close >= last.open ? upColor : downColor
        ctx.fillRect(width - padR - labelW, lastY - 9, labelW, 14)
        ctx.fillStyle = '#ffffff'
        ctx.textAlign = 'center'
        ctx.fillText(label, width - padR - labelW / 2, lastY + 2)
        ctx.textAlign = 'left'
      }
    },
  },
})
