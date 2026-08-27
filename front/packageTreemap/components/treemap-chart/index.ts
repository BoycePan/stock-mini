/**
 * 大盘云图热力图 Canvas 组件（canvas 2d）：
 * - Squarified treemap 布局：面积=市值（weight），颜色=涨跌幅（pct）
 * - 红涨绿跌（与全局涨跌色一致 #eb514d / #20a66a），深浅随 |pct| 变化（10 级色阶）
 * - 点击命中检测：tap 反查方块，触发 select 事件（板块钻取 / 个股跳转）
 * - 双主题兼容：背景/边框/文字随 theme 切换，涨跌色两主题一致
 * - 数据刷新 / 主题切换 / 画布高度变化自动重绘
 *
 * 颜色参考 52etf.site 大盘云图：上涨为红系、下跌为绿系，|pct| 越大越饱和；
 * 文字颜色按色块亮度自适应（浅色块深字、深色块浅字），保证两主题可读。
 */

import { bindTheme, getTheme, unbindTheme } from '../../../utils/theme'
import type { TreemapNode } from '../../types/treemap'
import { squarifyTreemap, type LayoutRect } from '../../utils/treemap-layout'

type CanvasNode = WechatMiniprogram.Canvas
type CanvasCtx = WechatMiniprogram.CanvasRenderingContext.CanvasRenderingContext2D

/** 涨跌基准色（与全局一致，供角标使用） */
const UP_COLOR = '#eb514d'
const DOWN_COLOR = '#20a66a'

/** 色阶：涨跌停基准（|pct| >= 7% 视为最深色） */
const PCT_FULL = 7

interface TileColor {
  fill: string
  label: string
}

/** 由 pct 取 0..1 深度系数（0=平盘，1=涨停/跌停附近） */
function depthOf(pct: number | null | undefined): number {
  if (pct === null || pct === undefined || !Number.isFinite(pct)) return 0
  const abs = Math.min(Math.abs(pct), PCT_FULL)
  return abs / PCT_FULL
}

/** 依据色块亮度选择文字颜色：亮块用深字，暗块用浅字 */
function labelColor(r: number, g: number, b: number, isDark: boolean): string {
  const lum = 0.299 * r + 0.587 * g + 0.114 * b
  if (lum >= 160) return isDark ? '#0f1722' : '#152338'
  return isDark ? '#f5f7fb' : '#ffffff'
}

/**
 * 返回某节点的填充色与文字色（红涨绿跌，深浅随 |pct|）。
 * 浅/深主题各自一套底色，保证双主题下色块与背景有足够对比；
 * 基准涨跌色在两主题下保持一致（仅亮度/饱和度不同）。
 */
function tileColor(pct: number | null | undefined, isDark: boolean): TileColor {
  // 深度用 <1 的幂次，让小涨/小跌更快饱和，视觉上贴近 52etf 的强红/强绿
  const d = Math.pow(depthOf(pct), 0.6)
  if (pct === null || pct === undefined || !Number.isFinite(pct)) {
    // 无数据：中性底色
    return isDark ? { fill: '#1a2637', label: '#9cacc0' } : { fill: '#f2f6fa', label: '#718096' }
  }

  let r: number
  let g: number
  let b: number
  if (pct >= 0) {
    // 上涨：红系。浅色从浅红到深红；深色从暗红到亮红
    if (isDark) {
      r = Math.round(60 + 184 * d)
      g = Math.round(35 + 71 * d)
      b = Math.round(45 + 53 * d)
    } else {
      r = Math.round(252 - 40 * d)
      g = Math.round(229 - 182 * d)
      b = Math.round(227 - 185 * d)
    }
  } else {
    // 下跌：绿系。浅色从浅绿到深绿；深色从暗绿到亮绿
    if (isDark) {
      r = Math.round(28 + 32 * d)
      g = Math.round(53 + 142 * d)
      b = Math.round(42 + 78 * d)
    } else {
      r = Math.round(228 - 213 * d)
      g = Math.round(245 - 95 * d)
      b = Math.round(235 - 141 * d)
    }
  }
  r = Math.max(0, Math.min(255, r))
  g = Math.max(0, Math.min(255, g))
  b = Math.max(0, Math.min(255, b))
  return { fill: `rgb(${r},${g},${b})`, label: labelColor(r, g, b, isDark) }
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
    /** 画布高度（CSS px，>0 时覆盖 100% 高度，用于可滚动布局） */
    height: { type: Number, value: 0 },
    /** 空态文案（加载中 / 暂无数据） */
    emptyText: { type: String, value: '' },
  },
  observers: {
    'nodes, theme, height': function () {
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
          const propHeight = (this.data.height as number) || 0
          const width = info.width || 320
          // 高度优先用外部传入的 height，避免 setData 后 canvas 尚未 reflow 读到旧值
          const height = propHeight > 0 ? propHeight : info.height || 240
          const pixelRatio = wx.getWindowInfo().pixelRatio || 2
          canvas.width = width * pixelRatio
          canvas.height = height * pixelRatio
          const ctx = canvas.getContext('2d')
          if (!ctx) return
          ctx.setTransform(1, 0, 0, 1, 0, 0)
          ctx.scale(pixelRatio, pixelRatio)
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
      ctx.fillStyle = isDark ? '#111827' : '#eef3f8'
      ctx.fillRect(0, 0, width, height)

      if (!nodes || nodes.length === 0) {
        const text = this.data.emptyText || '暂无数据'
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
      const border = isDark ? '#111827' : '#eef3f8'

      for (const item of layout) {
        const node = nodeById.get(item.id)
        if (!node) continue
        const x = item.x + pad / 2
        const y = item.y + pad / 2
        const w = item.w - pad
        const h = item.h - pad
        if (w <= 1 || h <= 1) continue

        // 色块（红涨绿跌，深浅随 |pct|）
        const color = tileColor(node.pct, isDark)
        ctx.fillStyle = color.fill
        ctx.fillRect(x, y, w, h)
        // 边框（与背景同色描边形成间隙）
        ctx.strokeStyle = border
        ctx.lineWidth = pad
        ctx.strokeRect(x - pad / 2, y - pad / 2, w + pad, h + pad)

        // 涨跌角标（右上角小三角，红涨绿跌；平盘不画）
        if (node.pct !== null && node.pct !== undefined && Math.abs(node.pct) > 0.000001) {
          const isUp = node.pct > 0
          const size = Math.min(8, w / 4, h / 4)
          if (size > 3) {
            ctx.fillStyle = isUp ? UP_COLOR : DOWN_COLOR
            ctx.beginPath()
            ctx.moveTo(x + w, y)
            ctx.lineTo(x + w - size, y)
            ctx.lineTo(x + w, y + size)
            ctx.closePath()
            ctx.fill()
          }
        }

        // 文字（按可用空间分级展示）
        this.renderLabel(st, node, x, y, w, h, color)
      }
    },
    renderLabel(
      st: ChartState,
      node: TreemapNode,
      x: number,
      y: number,
      w: number,
      h: number,
      color: TileColor,
    ) {
      const { ctx } = st
      const name = node.name
      const pctText =
        node.pct === null || node.pct === undefined
          ? ''
          : `${node.pct > 0 ? '+' : ''}${node.pct.toFixed(2)}%`

      // 太小：仅当能容纳至少 2 个字时才画名字
      if (w < 30 || h < 20) return
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'

      if (w < 56 || h < 38) {
        // 只画名字（截断）
        ctx.font = '10px sans-serif'
        ctx.fillStyle = color.label
        const maxName = Math.max(1, Math.floor((w - 4) / 10))
        ctx.fillText(truncate(name, maxName), x + w / 2, y + h / 2)
        return
      }

      // 名字 + 涨跌幅两行
      ctx.font = '12px sans-serif'
      ctx.fillStyle = color.label
      const nameFontW = Math.max(1, Math.floor((w - 6) / 12))
      ctx.fillText(truncate(name, nameFontW), x + w / 2, y + h / 2 - 9)
      if (pctText) {
        ctx.font = '11px sans-serif'
        ctx.fillStyle = color.label
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
            // 附带命中块尺寸，便于上浮提示/跳转判断
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
