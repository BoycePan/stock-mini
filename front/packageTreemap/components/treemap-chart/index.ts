/**
 * 大盘云图热力图 Canvas 组件（canvas 2d）：
 * - Squarified treemap 布局：面积=市值（weight），颜色=涨跌幅（pct）
 * - 红涨绿跌（与全局涨跌色一致 #eb514d / #20a66a），深浅随 |pct| 变化（10 级色阶）
 * - 点击命中检测：tap 反查方块，触发 select 事件（板块钻取 / 个股跳转）
 * - 双主题兼容：背景/边框/文字随 theme 切换，涨跌色两主题一致
 * - 数据刷新 / 主题切换自动重绘
 */

import { bindTheme, getTheme, unbindTheme } from '../../../utils/theme'
import type { TreemapNode } from '../../types/treemap'
import { squarifyTreemap, type LayoutRect } from '../../utils/treemap-layout'

type CanvasNode = WechatMiniprogram.Canvas
type CanvasCtx = WechatMiniprogram.CanvasRenderingContext.CanvasRenderingContext2D

/** 涨跌基准色（与全局一致） */
const UP_COLOR = '#eb514d'
const DOWN_COLOR = '#20a66a'

/** 色阶：涨跌停基准（|pct| >= 7% 视为最深色） */
const PCT_FULL = 7

/**
 * 涨跌色阶（红涨绿跌，与全局涨跌色一致；深浅随 |pct| 变化）：
 * 平盘 → 中性底色；深度 1 → 基准涨跌色；深度越大颜色越深（接近涨停/跌停色）。
 * 浅/深主题各自一套底色，保证双主题下色块与背景有足够对比。
 */
function levelColor(pct: number | null | undefined, isDark: boolean): string {
  const depth = depthOf(pct)
  if (pct === null || pct === undefined || !Number.isFinite(pct)) {
    // 无数据：中性底色
    return isDark ? '#1a2637' : '#f2f6fa'
  }
  if (pct >= 0) {
    // 上涨：红系。浅色从浅红(#fde8e7)到深红(#d43a3a)；深色从暗红(#3a2430)到亮红(#e05a55)
    if (isDark) {
      const r = Math.round(58 + 172 * depth)
      const g = Math.round(36 + 40 * depth)
      const b = Math.round(48 + 35 * depth)
      return `rgb(${r},${g},${b})`
    }
    const r = Math.round(253 - 24 * depth)
    const g = Math.round(232 - 185 * depth)
    const b = Math.round(231 - 185 * depth)
    return `rgb(${r},${g},${b})`
  }
  // 下跌：绿系。浅色从浅绿(#e4f6ec)到深绿(#178a55)；深色从暗绿(#1c3228)到亮绿(#3aa878)
  if (isDark) {
    const r = Math.round(28 + 26 * depth)
    const g = Math.round(50 + 106 * depth)
    const b = Math.round(40 + 72 * depth)
    return `rgb(${r},${g},${b})`
  }
  const r = Math.round(228 - 195 * depth)
  const g = Math.round(246 - 172 * depth)
  const b = Math.round(236 - 173 * depth)
  return `rgb(${r},${g},${b})`
}

/** 由 pct 取 0..1 深度系数（0=平盘，1=涨停/跌停附近） */
function depthOf(pct: number | null | undefined): number {
  if (pct === null || pct === undefined || !Number.isFinite(pct)) return 0
  const abs = Math.min(Math.abs(pct), PCT_FULL)
  return abs / PCT_FULL
}

interface ChartState {
  ctx: CanvasCtx
  width: number
  height: number
  isDark: boolean
  nodes: TreemapNode[]
  layout: LayoutRect[]
  padding: number
}

const chartState = new WeakMap<object, ChartState>()

Component({
  properties: {
    nodes: { type: Array, value: [] as TreemapNode[] },
    theme: { type: String, value: 'light' },
    /** 空态文案（加载中 / 暂无数据） */
    emptyText: { type: String, value: '' },
  },
  observers: {
    'nodes, theme': function () {
      this.draw(this.data.nodes as TreemapNode[])
    },
  },
  lifetimes: {
    attached() {
      this.setData({ theme: getTheme() })
      bindTheme(this)
    },
    ready() {
      this.draw(this.data.nodes as TreemapNode[])
    },
    detached() {
      unbindTheme(this)
    },
  },
  methods: {
    draw(nodes: TreemapNode[]) {
      this.createSelectorQuery()
        .select('#treemap-canvas')
        .fields({ node: true, size: true, rect: true })
        .exec((result) => {
          const info = result?.[0] as
            | { node?: CanvasNode; width?: number; height?: number; left?: number; top?: number }
            | undefined
          const canvas = info?.node
          if (!canvas) return
          const width = info.width || 320
          const height = info.height || 240
          const dpr = wx.getWindowInfo().pixelRatio || 2
          canvas.width = width * dpr
          canvas.height = height * dpr
          const ctx = canvas.getContext('2d')
          ctx.scale(dpr, dpr)
          chartState.set(this, {
            ctx,
            width,
            height,
            isDark: this.data.theme === 'dark',
            nodes: nodes as TreemapNode[],
            layout: [],
            padding: 0,
          })
          this.render()
        })
    },
    render() {
      const st = chartState.get(this)
      if (!st) return
      const { ctx, width, height, nodes, isDark } = st
      ctx.clearRect(0, 0, width, height)

      // 背景
      ctx.fillStyle = isDark ? '#151e2d' : '#eef3f8'
      ctx.fillRect(0, 0, width, height)

      if (!nodes || nodes.length === 0) {
        const text = this.data.emptyText || (isDark ? '暂无数据' : '暂无数据')
        ctx.fillStyle = isDark ? '#8a97a8' : '#718096'
        ctx.font = '13px sans-serif'
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText(text, width / 2, height / 2)
        return
      }

      // 布局（留 2px 间隙避免相邻块贴合）
      const pad = 2
      const layout = squarifyTreemap(
        nodes.map((node) => ({ id: node.id, weight: node.weight })),
        { x: 0, y: 0, w: width, h: height },
      )
      st.layout = layout
      st.padding = pad

      // 用 Map 索引避免每块 O(n) 查找（496 板块 / 500+ 成分股下更稳）
      const nodeById = new Map(nodes.map((node) => [node.id, node]))

      for (const item of layout) {
        const node = nodeById.get(item.id)
        if (!node) continue
        const x = item.x + pad / 2
        const y = item.y + pad / 2
        const w = item.w - pad
        const h = item.h - pad
        if (w <= 1 || h <= 1) continue

        // 色块（红涨绿跌，深浅随 |pct|）
        ctx.fillStyle = levelColor(node.pct, isDark)
        ctx.fillRect(x, y, w, h)
        // 边框（与背景同色描边形成间隙）
        ctx.strokeStyle = isDark ? '#151e2d' : '#eef3f8'
        ctx.lineWidth = pad
        ctx.strokeRect(x - pad / 2, y - pad / 2, w + pad, h + pad)

        // 涨跌角标（右上角小三角，红涨绿跌；平盘不画）
        if (node.pct !== null && node.pct !== undefined && Math.abs(node.pct) > 0.000001) {
          const color = node.pct > 0 ? UP_COLOR : DOWN_COLOR
          const size = Math.min(8, w / 4, h / 4)
          if (size > 3) {
            ctx.fillStyle = color
            ctx.beginPath()
            ctx.moveTo(x + w, y)
            ctx.lineTo(x + w - size, y)
            ctx.lineTo(x + w, y + size)
            ctx.closePath()
            ctx.fill()
          }
        }

        // 文字（按可用空间分级展示）
        this.renderLabel(st, node, x, y, w, h)
      }
    },
    renderLabel(st: ChartState, node: TreemapNode, x: number, y: number, w: number, h: number) {
      const { ctx, isDark } = st
      const textColor = isDark ? '#f5f7fb' : '#152338'
      const subColor = isDark ? '#9cacc0' : '#718096'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'

      const name = node.name
      const pctText =
        node.pct === null || node.pct === undefined
          ? ''
          : `${node.pct > 0 ? '+' : ''}${node.pct.toFixed(2)}%`

      if (w < 34 || h < 24) return // 太小不画
      if (w < 58 || h < 40) {
        // 只画名字（截断）
        ctx.font = '10px sans-serif'
        ctx.fillStyle = textColor
        const maxName = Math.floor((w - 4) / 10)
        ctx.fillText(truncate(name, maxName), x + w / 2, y + h / 2)
        return
      }

      // 名字 + 涨跌幅两行
      ctx.font = '12px sans-serif'
      ctx.fillStyle = textColor
      const nameFontW = Math.floor((w - 6) / 12)
      ctx.fillText(truncate(name, nameFontW), x + w / 2, y + h / 2 - 9)
      if (pctText) {
        ctx.font = '11px sans-serif'
        ctx.fillStyle = subColor
        ctx.fillText(pctText, x + w / 2, y + h / 2 + 8)
      }
    },
    /** 点击命中：反查方块并触发 select 事件 */
    onTap(event: WechatMiniprogram.TouchEvent) {
      const st = chartState.get(this)
      if (!st || !st.layout.length) return
      // canvas touch 事件的坐标在 changedTouches[0]（相对 canvas 左上角，x/y 字段）
      const touch = event.changedTouches?.[0] as { x: number; y: number } | undefined
      if (!touch) return
      const x = touch.x
      const y = touch.y
      // 从后往前找（后绘制的在上层）
      const nodeById = new Map(st.nodes.map((n) => [n.id, n]))
      for (let i = st.layout.length - 1; i >= 0; i--) {
        const item = st.layout[i]
        if (!item) continue
        const half = st.padding / 2
        if (
          x >= item.x + half &&
          x <= item.x + item.w - half &&
          y >= item.y + half &&
          y <= item.y + item.h - half
        ) {
          const node = nodeById.get(item.id)
          if (node) {
            this.triggerEvent('select', { node })
            return
          }
        }
      }
    },
  },
})

function truncate(text: string, max: number): string {
  if (max <= 0) return ''
  if (text.length <= max) return text
  return `${text.slice(0, Math.max(1, max - 1))}…`
}
