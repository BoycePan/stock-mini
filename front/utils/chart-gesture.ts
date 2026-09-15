/**
 * 图表触摸手势状态机（纯函数，可单测）：**单指横向拖动 = 平移，双指捏合 = 缩放**，
 * 单指轻点 / 小幅移动 = 十字光标。两个 K 线图表组件（quote-chart / kline-chart）共用，
 * 保证两处识别阈值与手感完全一致。
 *
 * 用法（组件侧只负责把返回的动作映射到自己的绘制 / 窗口状态）：
 * ```ts
 * onTouchStart(e) { const u = beginGesture(e.touches ?? [], cfg()); this.gesture = u.state; this.run(u.action) }
 * onTouchMove(e)  { const u = moveGesture(this.gesture, e.touches ?? [], cfg()); this.gesture = u.state; this.run(u.action) }
 * onTouchEnd(e)   { const u = endGesture(e.touches?.length ?? 0); this.gesture = u.state; this.run(u.action) }
 * ```
 * 几何换算（根数吸附、缩放锚点、上下限夹紧）全部复用 utils/kline-viewport.ts。
 */

import { dragViewport, MIN_VIEW_BARS, pinchViewport, type ViewportState } from './kline-viewport'

/** 单指横向拖动进入平移模式的阈值（px）：小于它视为轻点查看十字光标 */
export const PAN_TRIGGER_PX = 8

/**
 * 触摸点结构：canvas 触摸事件的 touches[i] 运行时自带相对画布的 x/y，
 * 类型声明里只有 clientX/clientY，故用具名结构类型承接（两种都兼容）。
 */
export interface GestureTouch {
  x?: number
  y?: number
  clientX?: number
  clientY?: number
}

/** 手势识别需要的当前状态（由组件在每次事件时提供，随窗口 / 布局实时变化） */
export interface GestureConfig {
  /** 是否允许平移 / 缩放（K 线周期且根数超过最小窗口；否则只出十字光标） */
  zoomable: boolean
  /** 全量根数 */
  total: number
  /** 当前可见窗口 */
  viewport: ViewportState
  /** 绘图区左边界（缩放锚点换算用） */
  padL: number
  /** 绘图区宽度（拖动换算与锚点换算用） */
  plotW: number
  /** 画布在页面中的左偏移（触摸点没有 canvas 相对坐标时兜底换算） */
  rectLeft: number
}

/** 手势识别结果：交给组件执行 */
export type GestureAction =
  /** 把十字光标移到该画布 x 坐标对应的那根 */
  | { kind: 'crosshair'; x: number }
  /** 收起十字光标（进入平移 / 缩放） */
  | { kind: 'clear' }
  /** 应用新的可见窗口（平移 / 缩放结果） */
  | { kind: 'viewport'; viewport: ViewportState }

/** 手势状态（由组件持有，事件之间透传） */
export interface GestureState {
  mode: 'single' | 'pinch'
  /** 手势起点（画布坐标） */
  startX: number
  startY: number
  /** 手势起点时的窗口：拖动 / 缩放都以它为基准换算，避免逐帧累加漂移 */
  base: ViewportState
  /** 捏合起始指距（px） */
  pinchDist: number
  /** 捏合锚点在手势起点窗口内的相对位置（0=窗口最左，1=最右） */
  anchorRatio: number
  /** 单指手势是否已进入平移模式（进入后不再更新十字光标） */
  panned: boolean
}

/** 一次手势事件的返回：新的状态 + 需要执行的动作（null = 不做事） */
export interface GestureUpdate {
  state: GestureState | null
  action: GestureAction | null
}

/** 触摸点 → 画布左上角坐标（优先运行时自带的 canvas 相对坐标） */
export function gesturePoint(
  touch: GestureTouch | undefined,
  rectLeft: number,
): { x: number; y: number } | null {
  if (!touch) return null
  return {
    x: typeof touch.x === 'number' ? touch.x : (touch.clientX ?? 0) - rectLeft,
    y: typeof touch.y === 'number' ? touch.y : (touch.clientY ?? 0),
  }
}

/** 两指指距（px）：任一点缺失返回 0（调用方视为无法起算缩放） */
export function pinchDistance(touches: ReadonlyArray<GestureTouch>, rectLeft: number): number {
  const first = gesturePoint(touches[0], rectLeft)
  const second = gesturePoint(touches[1], rectLeft)
  if (!first || !second) return 0
  return Math.hypot(first.x - second.x, first.y - second.y)
}

/** 两指中点 → 锚点相对位置（0=窗口最左，1=最右），用于「捏住哪根就定住哪根」 */
function pinchAnchor(touches: ReadonlyArray<GestureTouch>, config: GestureConfig): number {
  if (!(config.plotW > 0)) return 1
  const first = gesturePoint(touches[0], config.rectLeft)
  const second = gesturePoint(touches[1], config.rectLeft)
  if (!first || !second) return 1
  const midX = (first.x + second.x) / 2
  return Math.max(0, Math.min(1, (midX - config.padL) / config.plotW))
}

/** 可否缩放 / 平移：调用方声明可缩放，且根数确实超过最小窗口 */
function canViewport(config: GestureConfig): boolean {
  return config.zoomable && config.total > MIN_VIEW_BARS
}

/** 触摸开始：双指 → 捏合基准；单指 → 记起点并显示十字光标 */
export function beginGesture(
  touches: ReadonlyArray<GestureTouch>,
  config: GestureConfig,
): GestureUpdate {
  if (touches.length >= 2 && canViewport(config)) {
    return {
      state: {
        mode: 'pinch',
        startX: 0,
        startY: 0,
        base: config.viewport,
        pinchDist: pinchDistance(touches, config.rectLeft),
        anchorRatio: pinchAnchor(touches, config),
        panned: false,
      },
      action: { kind: 'clear' },
    }
  }
  const point = gesturePoint(touches[0], config.rectLeft)
  return {
    state: {
      mode: 'single',
      startX: point?.x ?? 0,
      startY: point?.y ?? 0,
      base: config.viewport,
      pinchDist: 0,
      anchorRatio: 1,
      panned: false,
    },
    action: point ? { kind: 'crosshair', x: point.x } : null,
  }
}

/** 触摸移动：按模式给出平移 / 缩放 / 十字光标动作 */
export function moveGesture(
  state: GestureState | null,
  touches: ReadonlyArray<GestureTouch>,
  config: GestureConfig,
): GestureUpdate {
  if (!state) return { state: null, action: null }

  // 双指缩放（第二根手指在拖动途中落下 → 用当前窗口重新起算基准）
  if (state.mode === 'pinch' || touches.length >= 2) {
    if (!canViewport(config) || touches.length < 2) return { state, action: null }
    if (state.mode !== 'pinch') {
      return {
        state: {
          mode: 'pinch',
          startX: 0,
          startY: 0,
          base: config.viewport,
          pinchDist: pinchDistance(touches, config.rectLeft),
          anchorRatio: pinchAnchor(touches, config),
          panned: false,
        },
        action: { kind: 'clear' },
      }
    }
    const dist = pinchDistance(touches, config.rectLeft)
    if (!(dist > 0) || !(state.pinchDist > 0)) return { state, action: null }
    const viewport = pinchViewport(
      config.total,
      state.base,
      dist / state.pinchDist,
      state.anchorRatio,
    )
    if (viewport.viewBars === state.base.viewBars && viewport.viewEnd === state.base.viewEnd) {
      return { state, action: null }
    }
    return { state, action: { kind: 'viewport', viewport } }
  }

  const point = gesturePoint(touches[0], config.rectLeft)
  if (!point) return { state, action: null }
  const dx = point.x - state.startX
  const dy = point.y - state.startY

  if (state.panned) {
    return {
      state,
      action: {
        kind: 'viewport',
        viewport: dragViewport(config.total, state.base, dx, config.plotW),
      },
    }
  }
  // 横向位移超过阈值且占优 → 进入平移；否则维持十字光标
  if (canViewport(config) && Math.abs(dx) > PAN_TRIGGER_PX && Math.abs(dx) > Math.abs(dy)) {
    return {
      state: { ...state, panned: true },
      action: {
        kind: 'viewport',
        viewport: dragViewport(config.total, state.base, dx, config.plotW),
      },
    }
  }
  return { state, action: { kind: 'crosshair', x: point.x } }
}

/**
 * 触摸结束：`remaining` = 事件里仍按在屏幕上的手指数。
 * 捏合途中先松开一根手指（remaining > 0）时本次手势作废，避免残留基准导致误平移；
 * 全部抬起则收起十字光标。
 */
export function endGesture(remaining: number): GestureUpdate {
  return { state: null, action: remaining > 0 ? null : { kind: 'clear' } }
}
