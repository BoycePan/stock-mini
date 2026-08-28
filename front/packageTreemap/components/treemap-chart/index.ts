/**
 * 大盘云图热力图 Canvas 组件（canvas 2d）：
 * - Squarified treemap 布局：面积=市值（weight），颜色=涨跌幅（pct）
 * - 红涨绿跌（与全局涨跌色一致 #eb514d / #20a66a），深浅随 |pct| 变化（10 级色阶）
 * - 画布即视口大小，内容（宽=视口宽，高=外部传入 contentH）经「视图变换」绘制：
 *   屏幕 = scale × 内容 + (tx, ty)，因此不再依赖页面 scroll-view
 * - 交互：
 *   - 双指捏合：围绕捏合中心缩放（1x ~ 6x），放大后小色块可读
 *   - 单指拖动：平移视图（内容超出视口时上下滚动，等效原 scroll-view），带惯性滚动
 *   - 点击命中：touchend 手动判定（canvas 挂 touch 处理器后，微信合成 tap 不可靠），
 *     坐标经逆变换反查方块，触发 select 事件
 *   - 右下角缩放指示（×1.0 / ×2.4…）：点击一键恢复 1x 回到顶部
 * - 数据刷新 / 主题切换 / 内容高度变化自动重绘，且保留当前缩放与平移位置
 * - 双主题兼容：背景/边框/文字随 theme 切换，涨跌色两主题一致
 *
 * 颜色参考 52etf.site 大盘云图：上涨为红系、下跌为绿系，|pct| 越大越饱和；
 * 文字颜色按色块亮度自适应（浅色块深字、深色块浅字），保证两主题可读。
 * 文字字号按「屏幕空间」自适应（随色块放大但封顶，截断保证不超出色块）；
 * 绘制在内容坐标系经 CTM 缩放，矢量渲染保持清晰。
 */

import { bindTheme, getTheme, unbindTheme } from '../../../utils/theme'
import type { TreemapNode } from '../../types/treemap'
import { squarifyTreemap, type LayoutRect } from '../../utils/treemap-layout'

type CanvasNode = WechatMiniprogram.Canvas
type CanvasCtx = WechatMiniprogram.CanvasRenderingContext.CanvasRenderingContext2D
/** canvas 触摸点（x/y 相对 canvas 左上角；泛型 TouchEvent 类型未声明该字段，需断言） */
type CanvasTouch = WechatMiniprogram.TouchCanvasDetail

/** 涨跌基准色（与全局一致，供角标使用） */
const UP_COLOR = '#eb514d'
const DOWN_COLOR = '#20a66a'

/** 色阶：涨跌停基准（|pct| >= 7% 视为最深色） */
const PCT_FULL = 7

/** 最小缩放（1x = 内容与画布同宽，等效旧版「可滚动原图」） */
const MIN_SCALE = 1
/** 最大缩放（放大后小色块可读） */
const MAX_SCALE = 6
/** 判定拖动/点击的位移阈值（CSS px），超过即视为拖动（抑制 tap） */
const TAP_MOVE_THRESHOLD = 8
/** 惯性滚动帧间隔（ms，按 60fps 估算） */
const FLING_MS = 16
/** 惯性滚动每帧速度衰减系数 */
const FLING_FRICTION = 0.94
/** 松手速度阈值（px/ms），超过才进入惯性滚动 */
const FLING_MIN_SPEED = 0.22

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
  canvas: CanvasNode
  dpr: number
  /** 视口尺寸（CSS px，画布显示区域） */
  viewportW: number
  viewportH: number
  /** 内容尺寸（CSS px，树图布局区；宽=视口宽，高=外部传入内容高度） */
  contentW: number
  contentH: number
  isDark: boolean
  nodes: TreemapNode[]
  layout: LayoutRect[]
  padding: number
  /** 视图变换：屏幕 = scale × 内容 + (tx, ty) */
  scale: number
  tx: number
  ty: number
  /** 手势状态（null=空闲） */
  gesture: GestureState | null
  /** 惯性滚动动画帧 id（null=未在滚动） */
  flingId: number | null
  /** 拖动发生后抑制随后的 tap 事件 */
  suppressTap: boolean
}

/** 双指捏合 / 单指拖动的手势状态 */
interface GestureState {
  pointers: Map<number, { x: number; y: number }>
  mode: 'none' | 'pan' | 'pinch'
  scale0: number
  tx0: number
  ty0: number
  dist0: number
  /** 捏合起点中点对应的内容坐标（保证手指下的内容不跑） */
  anchorX: number
  anchorY: number
  lastX: number
  lastY: number
  lastT: number
  vx: number
  vy: number
  moved: boolean
  totalDx: number
  totalDy: number
}

const chartState = new WeakMap<object, ChartState>()

function dist(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

function midpoint(
  a: { x: number; y: number },
  b: { x: number; y: number },
): { x: number; y: number } {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
}

Component({
  properties: {
    nodes: { type: Array, value: [] as TreemapNode[] },
    theme: { type: String, value: 'light' },
    /** 内容高度（CSS px，树图布局区高度；超出视口的部分可通过缩放/拖动查看） */
    height: { type: Number, value: 0 },
    /** 空态文案（加载中 / 暂无数据） */
    emptyText: { type: String, value: '' },
  },
  data: {
    /** 右下角缩放指示（''=1x 不显示；'×2.4' 等；点击复位） */
    zoomLabel: '',
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
      this.stopFling()
      unbindTheme(this)
    },
  },
  methods: {
    // -----------------------------------------------------------------------
    // 绘制
    // -----------------------------------------------------------------------

    /** 测量视口并初始化状态，然后重绘（保留上一次的缩放/平移/手势） */
    draw(nodes: TreemapNode[]) {
      this.createSelectorQuery()
        .select('#treemap-canvas')
        .fields({ node: true, size: true })
        .exec((result) => {
          const info = result?.[0] as
            { node?: CanvasNode; width?: number; height?: number } | undefined
          const canvas = info?.node
          if (!canvas) return
          const propHeight = (this.data.height as number) || 0
          const viewportW = info.width || 320
          const viewportH = info.height || 240
          const dpr = wx.getWindowInfo().pixelRatio || 2
          canvas.width = viewportW * dpr
          canvas.height = viewportH * dpr
          const ctx = canvas.getContext('2d')
          if (!ctx) return

          // 视口宽度不变时保留视图变换与手势（数据刷新 / 主题切换不打断查看位置）
          const prev = chartState.get(this)
          const keep = !!prev && prev.contentW === viewportW
          const state: ChartState = {
            ctx,
            canvas,
            dpr,
            viewportW,
            viewportH,
            contentW: viewportW,
            contentH: propHeight > 0 ? propHeight : viewportH,
            isDark: this.data.theme === 'dark',
            nodes: nodes as TreemapNode[],
            layout: [],
            padding: 2,
            scale: keep ? prev.scale : 1,
            tx: keep ? prev.tx : 0,
            ty: keep ? prev.ty : 0,
            gesture: keep ? prev.gesture : null,
            flingId: keep ? prev.flingId : null,
            suppressTap: keep ? prev.suppressTap : false,
          }
          chartState.set(this, state)
          const clamped = this.clampOffset(state)
          state.tx = clamped.tx
          state.ty = clamped.ty
          this.render()
        })
    },

    /** 全量重绘（变换/数据/主题变化后调用；只画可视窗口内的块） */
    render() {
      const st = chartState.get(this)
      if (!st) return
      const { ctx, viewportW: vw, viewportH: vh, isDark, scale } = st
      // 先回到设备像素坐标画背景
      ctx.setTransform(st.dpr, 0, 0, st.dpr, 0, 0)
      ctx.clearRect(0, 0, vw, vh)
      ctx.fillStyle = isDark ? '#111827' : '#eef3f8'
      ctx.fillRect(0, 0, vw, vh)

      if (!st.nodes || st.nodes.length === 0) {
        const text = this.data.emptyText || '暂无数据'
        ctx.fillStyle = isDark ? '#8a97a8' : '#718096'
        ctx.font = '13px sans-serif'
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText(text, vw / 2, vh / 2)
        this.syncZoomLabel(st)
        return
      }

      // 视图变换：屏幕 = scale × 内容 + (tx, ty)
      ctx.setTransform(st.dpr * scale, 0, 0, st.dpr * scale, st.dpr * st.tx, st.dpr * st.ty)

      if (!st.layout.length || !st.layout[0]) {
        st.layout = squarifyTreemap(
          st.nodes.map((node) => ({ id: node.id, weight: node.weight })),
          { x: 0, y: 0, w: st.contentW, h: st.contentH },
        )
      }

      // 用 Map 索引避免每块 O(n) 查找（496 板块 / 500+ 成分股下更稳）
      const nodeById = new Map(st.nodes.map((node) => [node.id, node]))
      const border = isDark ? '#111827' : '#eef3f8'
      const pad = st.padding
      // 边框随缩放收窄，避免放大后间隙过粗
      const lineW = Math.max(1, pad / Math.sqrt(scale))

      // 可视窗口（内容坐标）：屏幕 [0,vw]×[0,vh] 逆变换回去，裁剪屏幕外的块
      const viewX0 = Math.max(0, (0 - st.tx) / scale)
      const viewY0 = Math.max(0, (0 - st.ty) / scale)
      const viewX1 = Math.min(st.contentW, (vw - st.tx) / scale)
      const viewY1 = Math.min(st.contentH, (vh - st.ty) / scale)

      for (const item of st.layout) {
        if (!item) continue
        const node = nodeById.get(item.id)
        if (!node) continue
        if (
          item.x + item.w < viewX0 ||
          item.x > viewX1 ||
          item.y + item.h < viewY0 ||
          item.y > viewY1
        ) {
          continue
        }
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
        ctx.lineWidth = lineW
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

        // 文字（按「屏幕空间」尺寸分级展示：放大后小块的文字也会出现）
        this.renderLabel(st, node, x, y, w, h, color)
      }
      this.syncZoomLabel(st)
    },

    /**
     * 文字（自适应字号，保证不超出色块）：
     * - 所有判断与字号都按「屏幕空间」计算（sw = w×scale）：放大后小块能显示文字，
     *   且字号随盒子宽度增长但封顶（17~18px），不会出现放大后文字过大撑破盒子；
     * - 截断字数由「盒子宽度 ÷ 字号」反推，数学上保证文字宽度 ≤ 盒子宽度；
     * - 两行模式先定名字字号，再按总高压缩，保证两行纵向放得下。
     */
    renderLabel(
      st: ChartState,
      node: TreemapNode,
      x: number,
      y: number,
      w: number,
      h: number,
      color: TileColor,
    ) {
      const { ctx, scale } = st
      const name = node.name
      const pctText =
        node.pct === null || node.pct === undefined
          ? ''
          : `${node.pct > 0 ? '+' : ''}${node.pct.toFixed(2)}%`

      // 阈值按屏幕尺寸判断（sw = w×scale）：放大后小块的文字才会显示
      const sw = w * scale
      const sh = h * scale
      if (sw < 30 || sh < 20) return
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      const cx = x + w / 2
      const cy = y + h / 2

      if (sw < 56 || sh < 38) {
        // 只画名字：字号随盒子宽度自适应（屏幕 px，封顶 18），并截断到放得下
        const font = Math.max(9, Math.min(18, Math.floor(sw / 6), sh - 2))
        const maxName = Math.max(1, Math.floor((sw - 4) / font))
        ctx.font = `${(font / scale).toFixed(2)}px sans-serif`
        ctx.fillStyle = color.label
        ctx.fillText(truncate(name, maxName), cx, cy)
        return
      }

      // 名字 + 涨跌幅两行：先定名字字号（封顶 17），再按总高压缩
      let nameFont = Math.max(9, Math.min(17, Math.floor(sw / 7)))
      if (nameFont * 2 + 6 > sh) {
        nameFont = Math.max(9, Math.floor((sh - 6) / 2))
      }
      const pctFont = Math.max(8, nameFont - 1)
      const nameMax = Math.max(1, Math.floor((sw - 6) / nameFont))
      const pctMax = Math.max(1, Math.floor((sw - 6) / pctFont))
      // 两行中心距（屏幕 px），换算回内容坐标绘制
      const half = (nameFont + pctFont + 6) / 2
      ctx.font = `${(nameFont / scale).toFixed(2)}px sans-serif`
      ctx.fillStyle = color.label
      ctx.fillText(truncate(name, nameMax), cx, cy - half / scale)
      if (pctText) {
        ctx.font = `${(pctFont / scale).toFixed(2)}px sans-serif`
        ctx.fillStyle = color.label
        ctx.fillText(truncate(pctText, pctMax), cx, cy + half / scale)
      }
    },

    /** 平移/缩放越界钳制：内容始终覆盖视口（scale=1 时 tx 恒为 0，ty 即滚动位置） */
    clampOffset(
      st: ChartState,
      scale = st.scale,
      tx = st.tx,
      ty = st.ty,
    ): { tx: number; ty: number; clampedX: boolean; clampedY: boolean } {
      const { viewportW: vw, viewportH: vh, contentW: cw, contentH: ch } = st
      const minTx = Math.min(0, vw - cw * scale)
      const minTy = Math.min(0, vh - ch * scale)
      const clampedTx = Math.min(0, Math.max(minTx, tx))
      const clampedTy = Math.min(0, Math.max(minTy, ty))
      return {
        tx: clampedTx,
        ty: clampedTy,
        clampedX: clampedTx !== tx,
        clampedY: clampedTy !== ty,
      }
    },

    /** 同步右下角缩放指示（仅在值变化时 setData，避免手势每帧刷 data） */
    syncZoomLabel(st: ChartState) {
      const label = st.scale > 1.01 ? `×${st.scale.toFixed(1)}` : ''
      if (label !== this.data.zoomLabel) {
        this.setData({ zoomLabel: label })
      }
    },

    // -----------------------------------------------------------------------
    // 手势：双指捏合缩放 + 单指拖动平移（带惯性）
    // -----------------------------------------------------------------------

    onTouchStart(event: WechatMiniprogram.TouchEvent) {
      const st = chartState.get(this)
      if (!st) return
      this.stopFling()
      st.suppressTap = false
      const touches = (event.touches || []) as unknown as CanvasTouch[]
      const pointers = new Map<number, { x: number; y: number }>()
      for (const touch of touches) {
        pointers.set(touch.identifier, { x: touch.x, y: touch.y })
      }
      st.gesture = {
        pointers,
        mode: 'none',
        scale0: st.scale,
        tx0: st.tx,
        ty0: st.ty,
        dist0: 0,
        anchorX: 0,
        anchorY: 0,
        lastX: 0,
        lastY: 0,
        lastT: 0,
        vx: 0,
        vy: 0,
        moved: false,
        totalDx: 0,
        totalDy: 0,
      }
      this.beginGesture(st)
    },

    /** 根据当前触点数量确定手势模式（单指=平移，双指=捏合） */
    beginGesture(st: ChartState) {
      const g = st.gesture
      if (!g) return
      const points = [...g.pointers.values()]
      if (points.length >= 2) {
        const p1 = points[0] as { x: number; y: number }
        const p2 = points[1] as { x: number; y: number }
        g.mode = 'pinch'
        g.dist0 = dist(p1, p2) || 1
        const mid = midpoint(p1, p2)
        g.scale0 = st.scale
        g.tx0 = st.tx
        g.ty0 = st.ty
        g.anchorX = (mid.x - st.tx) / st.scale
        g.anchorY = (mid.y - st.ty) / st.scale
        st.suppressTap = true
      } else if (points.length === 1) {
        const p = points[0] as { x: number; y: number }
        g.mode = 'pan'
        g.tx0 = st.tx
        g.ty0 = st.ty
        g.lastX = p.x
        g.lastY = p.y
        g.lastT = Date.now()
        g.vx = 0
        g.vy = 0
        g.totalDx = 0
        g.totalDy = 0
      } else {
        g.mode = 'none'
      }
    },

    onTouchMove(event: WechatMiniprogram.TouchEvent) {
      const st = chartState.get(this)
      const g = st?.gesture
      if (!st || !g) return
      const touches = (event.touches || []) as unknown as CanvasTouch[]
      g.pointers.clear()
      for (const touch of touches) {
        g.pointers.set(touch.identifier, { x: touch.x, y: touch.y })
      }

      if (g.mode === 'pinch') {
        const points = [...g.pointers.values()]
        if (points.length >= 2) {
          const p1 = points[0] as { x: number; y: number }
          const p2 = points[1] as { x: number; y: number }
          const d = dist(p1, p2)
          if (d > 0) {
            const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, g.scale0 * (d / g.dist0)))
            const mid = midpoint(p1, p2)
            // 围绕捏合中心缩放：保持手指下的内容不动
            const tx = mid.x - scale * g.anchorX
            const ty = mid.y - scale * g.anchorY
            const clamped = this.clampOffset(st, scale, tx, ty)
            st.scale = scale
            st.tx = clamped.tx
            st.ty = clamped.ty
            this.render()
          }
        }
        return
      }

      if (g.mode === 'pan' && touches.length === 1) {
        const p = touches[0] as CanvasTouch
        const dx = p.x - g.lastX
        const dy = p.y - g.lastY
        const now = Date.now()
        const dt = Math.max(1, now - g.lastT)
        // 速度（px/ms）滑动平均，松手后用于惯性滚动
        g.vx = g.vx * 0.7 + (dx / dt) * 0.3
        g.vy = g.vy * 0.7 + (dy / dt) * 0.3
        g.lastX = p.x
        g.lastY = p.y
        g.lastT = now
        g.totalDx += dx
        g.totalDy += dy
        if (Math.abs(g.totalDx) > TAP_MOVE_THRESHOLD || Math.abs(g.totalDy) > TAP_MOVE_THRESHOLD) {
          g.moved = true
          st.suppressTap = true
        }
        const clamped = this.clampOffset(st, st.scale, st.tx + dx, st.ty + dy)
        st.tx = clamped.tx
        st.ty = clamped.ty
        this.render()
      }
    },

    onTouchEnd(event: WechatMiniprogram.TouchEvent) {
      const st = chartState.get(this)
      const g = st?.gesture
      if (!st || !g) return
      const changed = (event.changedTouches || []) as unknown as CanvasTouch[]
      for (const touch of changed) {
        g.pointers.delete(touch.identifier)
      }
      const remaining = [...g.pointers.values()]

      if (g.mode === 'pinch') {
        if (remaining.length === 1) {
          // 一根手指抬起 → 平滑切换为单指平移
          g.mode = 'pan'
          g.tx0 = st.tx
          g.ty0 = st.ty
          const p = remaining[0] as { x: number; y: number }
          g.lastX = p.x
          g.lastY = p.y
          g.lastT = Date.now()
          g.vx = 0
          g.vy = 0
          g.totalDx = 0
          g.totalDy = 0
          st.suppressTap = true
        } else if (remaining.length === 0) {
          this.endGesture(st)
        }
        return
      }

      if (g.mode === 'pan' && remaining.length === 0) {
        // 手动判定点击：canvas 挂 touch 处理器后，微信合成的 tap 事件不可靠，
        // 位移未超阈值且非捏合/拖动产生的抬起，按抬起点做命中检测
        if (!g.moved && !st.suppressTap && changed.length > 0) {
          const touch = changed[0] as CanvasTouch
          this.handleTap(st, touch.x, touch.y)
        }
        this.endGesture(st)
      }
    },

    onTouchCancel() {
      const st = chartState.get(this)
      if (st) {
        st.gesture = null
        st.suppressTap = false
      }
      this.stopFling()
    },

    /** 手势结束：速度足够则进入惯性滚动 */
    endGesture(st: ChartState) {
      const g = st.gesture
      if (!g) return
      st.gesture = null
      if (g.moved && Math.abs(g.vx) + Math.abs(g.vy) > FLING_MIN_SPEED) {
        this.startFling(st, g.vx, g.vy)
      }
    },

    /** 惯性滚动（平移松手后继续滑动，贴近原生滚动手感） */
    startFling(st: ChartState, vx: number, vy: number) {
      this.stopFling()
      const canvas = st.canvas
      const hasRaf = typeof canvas.requestAnimationFrame === 'function'
      const step = () => {
        const cur = chartState.get(this)
        if (!cur || cur.flingId === null) return
        const clamped = this.clampOffset(
          cur,
          cur.scale,
          cur.tx + vx * FLING_MS,
          cur.ty + vy * FLING_MS,
        )
        cur.tx = clamped.tx
        cur.ty = clamped.ty
        if (clamped.clampedX) vx = 0
        if (clamped.clampedY) vy = 0
        vx *= FLING_FRICTION
        vy *= FLING_FRICTION
        this.render()
        if (Math.abs(vx) < 0.01 && Math.abs(vy) < 0.01) {
          cur.flingId = null
          return
        }
        cur.flingId = hasRaf
          ? canvas.requestAnimationFrame(step)
          : (setTimeout(step, FLING_MS) as unknown as number)
      }
      st.flingId = hasRaf
        ? canvas.requestAnimationFrame(step)
        : (setTimeout(step, FLING_MS) as unknown as number)
    },

    stopFling() {
      const st = chartState.get(this)
      if (!st) return
      const id = st.flingId
      if (id === null || id === undefined) return
      const canvas = st.canvas
      if (canvas && typeof canvas.cancelAnimationFrame === 'function') {
        canvas.cancelAnimationFrame(id)
      } else {
        clearTimeout(id as unknown as number)
      }
      st.flingId = null
    },

    /** 点击复位：恢复 1x 并回到顶部 */
    onResetZoom() {
      const st = chartState.get(this)
      if (!st) return
      this.stopFling()
      st.scale = 1
      st.tx = 0
      st.ty = 0
      this.render()
    },

    /**
     * 点击命中（在 touchend 中手动判定：canvas 挂 touch 处理器后，微信合成的 tap 不可靠）：
     * 坐标经逆变换换算回内容空间，反查方块并触发 select 事件
     */
    handleTap(st: ChartState, x: number, y: number) {
      if (!st.layout.length) return
      const cx = (x - st.tx) / st.scale
      const cy = (y - st.ty) / st.scale
      // 从后往前找（后绘制的在上层）
      const nodeById = new Map(st.nodes.map((n) => [n.id, n]))
      for (let i = st.layout.length - 1; i >= 0; i--) {
        const item = st.layout[i]
        if (!item) continue
        const half = st.padding / 2
        if (
          cx >= item.x + half &&
          cx <= item.x + item.w - half &&
          cy >= item.y + half &&
          cy <= item.y + item.h - half
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
