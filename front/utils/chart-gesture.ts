/**
 * 图表触摸手势状态机（纯函数，可单测）：**单指 = 查看 K 线数据（十字光标），双指 = 缩放**。
 *
 * 单指拖动**不会**移动 K 线（避免「想读数却把图拖走」）：手指按在哪里、划到哪里，
 * 十字光标就跟着走到哪一根；窗口只能靠 `‹` / `›`（长按连发）、`+` / `−` 与双指捏合改变。
 * 两个 K 线图表组件（quote-chart / kline-chart）共用同一套识别逻辑。
 *
 * 用法（组件侧只负责把返回的动作映射到自己的绘制 / 窗口状态）：
 * ```ts
 * onTouchStart(e) { const u = beginGesture(e.touches ?? [], cfg()); this.gesture = u.state; this.run(u.action) }
 * onTouchMove(e)  { const u = moveGesture(this.gesture, e.touches ?? [], cfg()); this.gesture = u.state; this.run(u.action) }
 * onTouchEnd(e)   { const u = endGesture(e.touches?.length ?? 0); this.gesture = u.state; this.run(u.action) }
 * ```
 * 缩放换算（锚点、上下限夹紧）复用 utils/kline-viewport.ts 的 pinchViewport。
 */

import { MIN_VIEW_BARS, pinchViewport, type ViewportState } from './kline-viewport'

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
  /** 收起十字光标（进入双指缩放） */
  | { kind: 'clear' }
  /** 应用新的可见窗口（双指缩放结果） */
  | { kind: 'viewport'; viewport: ViewportState }

/** 手势状态（由组件持有，事件之间透传） */
export interface GestureState {
  mode: 'single' | 'pinch'
  /** 手势起点时的窗口：捏合以它为基准换算，避免逐帧累加漂移 */
  base: ViewportState
  /** 捏合起始指距（px） */
  pinchDist: number
  /** 捏合锚点在手势起点窗口内的相对位置（0=窗口最左，1=最右） */
  anchorRatio: number
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

/** 可否缩放：调用方声明可缩放，且根数确实超过最小窗口 */
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
        base: config.viewport,
        pinchDist: pinchDistance(touches, config.rectLeft),
        anchorRatio: pinchAnchor(touches, config),
      },
      action: { kind: 'clear' },
    }
  }
  const point = gesturePoint(touches[0], config.rectLeft)
  return {
    state: {
      mode: 'single',
      base: config.viewport,
      pinchDist: 0,
      anchorRatio: 1,
    },
    action: point ? { kind: 'crosshair', x: point.x } : null,
  }
}

/** 触摸移动：双指给出缩放动作，单指只移动十字光标（不改窗口） */
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
          base: config.viewport,
          pinchDist: pinchDistance(touches, config.rectLeft),
          anchorRatio: pinchAnchor(touches, config),
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
  // 单指只读数：手指到哪读到哪，窗口交给按钮（‹ › 长按连发）与双指缩放
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
