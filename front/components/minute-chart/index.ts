import type { MinutePoint } from '../../types/stock'
import { computeMinuteVolumeDirections } from '../../utils/minute'
import { bindTheme, getTheme, unbindTheme } from '../../utils/theme'

type CanvasNode = WechatMiniprogram.Canvas
type CanvasCtx = WechatMiniprogram.CanvasRenderingContext.CanvasRenderingContext2D

const UP_COLOR = '#eb514d'
const DOWN_COLOR = '#20a66a'

/**
 * 当日分时图（canvas 2d）：
 * - 价格线（以昨收 0% 为基准分段着色：突破 0% 用涨色红、跌破 0% 用跌色绿，穿越处换色）
 * - 均价线（橙色）
 * - 零轴：纵轴以昨收 0% 对称，中间网格线即零轴（实线高亮 + 「0%」标签）
 * - 下方成交量柱（每分钟柱按该分钟收盘价相对开盘价分色：涨红、跌绿、平盘白/灰；无成交量数据时整块隐藏，价格区占满）
 * - 点击 / 拖动 canvas 显示十字光标 + 信息框（时间 / 价格 / 涨跌 / 均价 / 成交量），同花顺式交互
 * - 画布内不展示「当前价格」「昨收」常驻标签；价格刻度绘制在左侧留白，不遮挡图形
 * - 深浅主题配色跟随 theme
 */
Component({
  properties: {
    points: { type: Array, value: [] as MinutePoint[] },
    /** 昨收（0 / 空 视为无基准线） */
    preClose: { type: Number, value: 0 },
    theme: { type: String, value: 'light' },
  },
  observers: {
    'points, preClose, theme': function () {
      this.draw(this.data.points as MinutePoint[], this.data.preClose as number)
    },
  },
  lifetimes: {
    attached() {
      this.setData({ theme: getTheme() })
      bindTheme(this)
    },
    ready() {
      // 等组件就绪后查询画布实际尺寸并绘制（points 晚于 ready 到达时由 observers 触发）
      this.draw(this.data.points as MinutePoint[], this.data.preClose as number)
    },
    detached() {
      unbindTheme(this)
    },
  },
  methods: {
    draw(points: MinutePoint[], preClose: number) {
      this.createSelectorQuery()
        .select('#minute-canvas')
        .fields({ node: true, size: true, rect: true })
        .exec((result) => {
          const info = result?.[0] as
            { node?: CanvasNode; width?: number; height?: number; left?: number } | undefined
          const canvas = info?.node
          if (!canvas) return
          const width = info.width || 320
          const height = info.height || 220
          const dpr = wx.getWindowInfo().pixelRatio || 2
          canvas.width = width * dpr
          canvas.height = height * dpr
          const ctx = canvas.getContext('2d')
          ctx.scale(dpr, dpr)
          // 数据自动刷新 / 主题切换触发重绘时，保留十字光标选中的索引（若仍有效）
          const prev = chartState.get(this)
          const prevActive =
            prev && prev.activeIndex !== null && points.length > 0
              ? Math.min(prev.activeIndex, points.length - 1)
              : null
          chartState.set(this, {
            ctx,
            width,
            height,
            points: points as MinutePoint[],
            preClose,
            isDark: this.data.theme === 'dark',
            rectLeft: info.left ?? 0,
            padL: 0,
            padR: 12,
            padT: 16,
            padB: 14,
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
      if (!st.points || st.points.length < 2) {
        ctx.fillStyle = st.isDark ? '#8a97a8' : '#9aa7b8'
        ctx.font = '12px sans-serif'
        ctx.textAlign = 'center'
        ctx.fillText('暂无分时数据', width / 2, height / 2)
        return
      }
      this.renderChart(st)
      if (st.activeIndex !== null) this.renderCrosshair(st)
    },
    /** 绘制基础图（网格 / 昨收虚线 / 价格线 / 均价线 / 成交量柱 / 时间刻度），并把布局参数写回 state */
    renderChart(st: MinuteChartState) {
      const { ctx, width, height, points, preClose, isDark } = st
      const avgColor = isDark ? '#f5b94a' : '#f0a020'
      const gridColor = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(20,32,51,0.08)'
      const textColor = isDark ? '#8a97a8' : '#718096'
      const zeroColor = isDark ? 'rgba(255,255,255,0.6)' : 'rgba(20,32,51,0.55)'

      const hasPre = Number.isFinite(preClose) && preClose > 0
      const n = points.length

      // 纵轴范围：有昨收时以昨收 0% 为对称中心（取现价/均价相对昨收的最大偏离，上下幅度一致，留 8% 边距）
      let minP: number
      let maxP: number
      if (hasPre) {
        let dev = 0
        for (const p of points) {
          if (Number.isFinite(p.price)) dev = Math.max(dev, Math.abs(p.price - preClose))
          if (p.avg !== null && Number.isFinite(p.avg))
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
          if (Number.isFinite(p.price)) {
            min = Math.min(min, p.price)
            max = Math.max(max, p.price)
          }
          if (p.avg !== null && Number.isFinite(p.avg)) {
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

      // 左侧留白按价格刻度文字宽度自适应（右侧留小边距，无常驻标签）
      ctx.font = '10px sans-serif'
      ctx.textAlign = 'left'
      const gridLabels: string[] = []
      for (let i = 0; i <= 4; i += 1) {
        const price = maxP - ((maxP - minP) / 4) * i
        gridLabels.push(price.toFixed(2))
      }
      const padL = Math.min(120, Math.max(56, maxLabelWidth(ctx, gridLabels) + 14))
      const padR = 12
      const padT = 16
      const padB = 14
      // 无任何成交量数据的标的（指数/代理等）：不预留成交量区，价格区占满
      const hasVol = points.some((p) => (p.volume || 0) > 0)
      const volH = hasVol ? Math.max(56, Math.round(height * 0.24)) : 0
      const priceH = height - padT - padB - (hasVol ? volH + 12 : 0)
      const plotW = width - padL - padR

      st.padL = padL
      st.padR = padR
      st.padT = padT
      st.padB = padB
      st.volH = volH
      st.priceH = priceH
      st.plotW = plotW
      st.minP = minP
      st.maxP = maxP

      const priceY = (p: number) => padT + ((maxP - p) / (maxP - minP)) * priceH
      const xOf = (i: number) => padL + (n <= 1 ? plotW / 2 : (i / (n - 1)) * plotW)

      // 横向网格 + 价格刻度（右对齐在左侧留白内）
      // 纵轴已以昨收 0% 对称，中间网格线（i=2）即零轴：实线高亮 + 「0%」标签
      ctx.lineWidth = 1
      ctx.textAlign = 'right'
      for (let i = 0; i <= 4; i += 1) {
        const y = padT + (priceH / 4) * i
        const isZero = hasPre && i === 2
        ctx.strokeStyle = isZero ? zeroColor : gridColor
        ctx.beginPath()
        ctx.moveTo(padL, y)
        ctx.lineTo(width - padR, y)
        ctx.stroke()
        ctx.fillStyle = isZero ? zeroColor : textColor
        ctx.fillText(isZero ? '0%' : (gridLabels[i] ?? ''), padL - 8, y + 3)
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

      // 均价线
      ctx.strokeStyle = avgColor
      ctx.lineWidth = 1.2
      ctx.beginPath()
      let avgDrawn = false
      for (let i = 0; i < n; i += 1) {
        const avg = points[i]?.avg
        if (avg === null || avg === undefined || !Number.isFinite(avg)) continue
        const y = priceY(avg)
        if (!avgDrawn) {
          ctx.moveTo(xOf(i), y)
          avgDrawn = true
        } else {
          ctx.lineTo(xOf(i), y)
        }
      }
      if (avgDrawn) ctx.stroke()

      // 成交量柱（下方区域）：每根柱按该分钟收盘价相对开盘价分色（涨红、跌绿、平盘白/灰），
      // 同色柱合并为一个 path 批量 fill 提升性能，无成交量数据时跳过
      if (hasVol) {
        const volMax = Math.max(...points.map((p) => p.volume || 0), 1)
        const volTop = padT + priceH + 10
        const volBottom = height - padB
        const slot = plotW / n
        const bw = Math.max(1, slot * 0.6)
        const barH = (p: MinutePoint) =>
          (volBottom - volTop) * Math.min((p.volume || 0) / volMax, 1)

        const dirs = computeMinuteVolumeDirections(points, hasPre ? preClose : null)
        const flatColor = isDark ? 'rgba(195,206,222,0.55)' : 'rgba(154,167,184,0.65)'

        // 分组批量绘制：平（白/灰）、跌（绿）、涨（红）
        const groups: Array<{ match: (i: number) => boolean; color: string }> = [
          { match: (i) => dirs[i] === 'flat', color: flatColor },
          { match: (i) => dirs[i] === 'down', color: 'rgba(32,166,106,0.55)' },
          { match: (i) => dirs[i] === 'up', color: 'rgba(235,81,77,0.55)' },
        ]
        for (const g of groups) {
          ctx.beginPath()
          for (let i = 0; i < n; i += 1) {
            const p = points[i]
            if (!p || !g.match(i)) continue
            const h = barH(p)
            if (h <= 0) continue
            ctx.rect(xOf(i) - bw / 2, volBottom - h, bw, h)
          }
          ctx.fillStyle = g.color
          ctx.fill()
        }

        // 成交量区域分隔线
        ctx.strokeStyle = gridColor
        ctx.beginPath()
        ctx.moveTo(padL, volTop - 4)
        ctx.lineTo(width - padR, volTop - 4)
        ctx.stroke()
      }

      // 时间刻度（5 个等分点取实际时间）
      ctx.fillStyle = textColor
      ctx.textAlign = 'center'
      for (let i = 0; i <= 4; i += 1) {
        const idx = Math.min(n - 1, Math.round((i / 4) * (n - 1)))
        const t = points[idx]?.time ?? ''
        ctx.fillText(t, xOf(idx), height - 2)
      }
    },
    /** 十字光标 + 信息框（同花顺式） */
    renderCrosshair(st: MinuteChartState) {
      const { ctx, width, height, points, preClose, isDark } = st
      const idx = st.activeIndex
      if (idx === null) return
      const p = points[idx]
      if (!p) return
      const n = points.length
      const { padL, padR, padT, padB, priceH, plotW, minP, maxP } = st
      const hasPre = Number.isFinite(preClose) && preClose > 0
      const up = hasPre ? p.price >= preClose : true
      const mainColor = up ? UP_COLOR : DOWN_COLOR
      const avgColor = isDark ? '#f5b94a' : '#f0a020'
      const lineColor = isDark ? 'rgba(255,255,255,0.4)' : 'rgba(20,32,51,0.35)'
      const priceY = (v: number) => padT + ((maxP - v) / (maxP - minP)) * priceH
      const x = padL + (idx / (n - 1)) * plotW
      const y = priceY(p.price)

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

      // 价格线 / 均价线上的标记点
      ctx.fillStyle = mainColor
      ctx.beginPath()
      ctx.arc(x, y, 3.5, 0, Math.PI * 2)
      ctx.fill()
      if (p.avg !== null && Number.isFinite(p.avg)) {
        ctx.fillStyle = avgColor
        ctx.beginPath()
        ctx.arc(x, priceY(p.avg), 3, 0, Math.PI * 2)
        ctx.fill()
      }

      // 信息框内容
      const rows: Array<{ text: string; color: string }> = []
      rows.push({ text: `时间 ${p.time}`, color: isDark ? '#c3cede' : '#66758a' })
      rows.push({ text: `价格 ${p.price.toFixed(2)}`, color: mainColor })
      if (hasPre) {
        const change = p.price - preClose
        const pct = preClose !== 0 ? (change / preClose) * 100 : 0
        rows.push({
          text: `涨跌 ${change >= 0 ? '+' : ''}${change.toFixed(2)}  ${change >= 0 ? '+' : ''}${pct.toFixed(2)}%`,
          color: up ? UP_COLOR : DOWN_COLOR,
        })
      }
      if (p.avg !== null && Number.isFinite(p.avg)) {
        rows.push({ text: `均价 ${p.avg.toFixed(2)}`, color: avgColor })
      }
      if ((p.volume || 0) > 0) {
        rows.push({
          text: `成交量 ${formatCrosshairVolume(p.volume)}`,
          color: isDark ? '#c3cede' : '#66758a',
        })
      }

      // 信息框位置：优先十字线右侧，越界则翻到左侧；纵向固定贴顶
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

      // 主题感知的信息框底色
      ctx.fillStyle = isDark ? 'rgba(20,32,51,0.92)' : 'rgba(255,255,255,0.94)'
      ctx.strokeStyle = isDark ? 'rgba(255,255,255,0.2)' : 'rgba(20,32,51,0.15)'
      ctx.beginPath()
      ctx.rect(boxX, boxY, boxW, boxH)
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
      if (!st || !st.points || st.points.length < 2 || st.plotW <= 0) return
      const touch = event.touches?.[0]
      if (!touch) return
      // canvas 触摸事件 touches[0] 运行时自带相对 canvas 的 x（类型声明未包含，这里显式取）
      const touchX = (touch as unknown as { x?: number }).x
      const x = typeof touchX === 'number' ? touchX : (touch.clientX ?? 0) - (st.rectLeft ?? 0)
      const raw = Math.round(((x - st.padL) / st.plotW) * (st.points.length - 1))
      const next = Math.max(0, Math.min(st.points.length - 1, raw))
      if (next !== st.activeIndex) {
        st.activeIndex = next
        this.render()
      }
    },
  },
})

interface MinuteChartState {
  ctx: CanvasCtx
  width: number
  height: number
  points: MinutePoint[]
  preClose: number
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
const chartState = new WeakMap<object, MinuteChartState>()

/** 一组文本的最大渲染宽度（当前 ctx.font 已设置） */
function maxLabelWidth(ctx: CanvasCtx, labels: string[]): number {
  let max = 0
  for (const label of labels) {
    const w = ctx.measureText(label).width
    if (w > max) max = w
  }
  return max
}

/** 十字光标信息框用的成交量简写 */
function formatCrosshairVolume(volume: number): string {
  if (!Number.isFinite(volume)) return '--'
  if (volume >= 100000000) return `${(volume / 100000000).toFixed(2)}亿`
  if (volume >= 10000) return `${(volume / 10000).toFixed(2)}万`
  return String(volume)
}
