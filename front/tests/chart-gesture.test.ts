import assert from 'node:assert/strict'
import test from 'node:test'

import {
  beginGesture,
  endGesture,
  moveGesture,
  type GestureConfig,
  type GestureState,
  type GestureTouch,
} from '../utils/chart-gesture.ts'
import { DEFAULT_VIEW_BARS, defaultViewport, MIN_VIEW_BARS } from '../utils/kline-viewport.ts'

const TOTAL = 200
const PAD_L = 40
const PLOT_W = 280
const RECT_LEFT = 20

function config(over: Partial<GestureConfig> = {}): GestureConfig {
  return {
    zoomable: true,
    total: TOTAL,
    viewport: defaultViewport(TOTAL),
    padL: PAD_L,
    plotW: PLOT_W,
    rectLeft: RECT_LEFT,
    ...over,
  }
}

/** 画布坐标点（组件里 touches[i] 运行时自带相对画布的 x/y） */
function at(x: number, y = 100): GestureTouch {
  return { x, y }
}

/** 走一遍「按下 → 移动 → 抬起」，返回收集到的动作类型序列 */
function drag(x0: number, x1: number, y0 = 100, y1 = 100, cfg = config()): string[] {
  const kinds: string[] = []
  const start = beginGesture([at(x0, y0)], cfg)
  if (start.action) kinds.push(start.action.kind)
  let state = start.state
  const steps = 4
  for (let i = 1; i <= steps; i += 1) {
    const x = x0 + ((x1 - x0) * i) / steps
    const y = y0 + ((y1 - y0) * i) / steps
    const update = moveGesture(state, [at(x, y)], cfg)
    state = update.state
    if (update.action) kinds.push(update.action.kind)
  }
  const end = endGesture(0)
  if (end.action) kinds.push(end.action.kind)
  return kinds
}

test('单指只查看数据：按下 / 拖动都只移动十字光标，不改窗口', () => {
  const cfg = config()
  const start = beginGesture([at(PAD_L + 100)], cfg)
  assert.equal(start.action?.kind, 'crosshair', '按下即显示十字光标')
  assert.equal(start.state?.mode, 'single')

  // 大幅横向拖动（旧版会进入平移）：现在仍然只是读数
  const far = moveGesture(start.state, [at(PAD_L + 260)], cfg)
  assert.equal(far.action?.kind, 'crosshair', '单指横向拖动不改窗口')
  if (far.action?.kind === 'crosshair') assert.equal(far.action.x, PAD_L + 260)

  // 竖向拖动（页面滚动场景）同样是读数
  const vertical = moveGesture(start.state, [at(PAD_L + 100, 220)], cfg)
  assert.equal(vertical.action?.kind, 'crosshair')
})

test('双指捏合：指距放大 → 根数变少、锚点那根停在原位；上下限夹紧', () => {
  const cfg = config()
  const start = beginGesture([at(PAD_L + 100, 100), at(PAD_L + 200, 100)], cfg)
  assert.equal(start.action?.kind, 'clear', '进入捏合先收起十字光标')
  assert.equal(start.state?.mode, 'pinch')
  // 两指中点 = PAD_L+150 → 窗口内相对位置 (150)/280
  const midRatio = 150 / PLOT_W
  assert.ok(Math.abs((start.state?.anchorRatio ?? 0) - midRatio) < 1e-9)

  // 指距翻倍（两指各向外 50px）→ 根数减半
  const zoomed = moveGesture(start.state, [at(PAD_L + 50, 100), at(PAD_L + 250, 100)], cfg)
  assert.equal(zoomed.action?.kind, 'viewport')
  if (zoomed.action?.kind === 'viewport') {
    assert.equal(zoomed.action.viewport.viewBars, DEFAULT_VIEW_BARS / 2)
    const startIndex = zoomed.action.viewport.viewEnd - zoomed.action.viewport.viewBars + 1
    const anchorAfter = startIndex + midRatio * (zoomed.action.viewport.viewBars - 1)
    const anchorBefore = TOTAL - DEFAULT_VIEW_BARS + midRatio * (DEFAULT_VIEW_BARS - 1)
    assert.ok(
      Math.abs(anchorAfter - anchorBefore) <= 1,
      `锚点那根应停在同一位置：${anchorAfter} vs ${anchorBefore}`,
    )
  }

  // 撑开到极限 → 最小窗口；捏合到极限 → 全量
  const spread = moveGesture(start.state, [at(PAD_L - 900, 100), at(PAD_L + 1200, 100)], cfg)
  if (spread.action?.kind === 'viewport') {
    assert.equal(spread.action.viewport.viewBars, MIN_VIEW_BARS)
  }
  const pinch = moveGesture(start.state, [at(PAD_L + 145, 100), at(PAD_L + 155, 100)], cfg)
  if (pinch.action?.kind === 'viewport') {
    assert.equal(pinch.action.viewport.viewBars, TOTAL)
  }
  // 死区：指距只变了 1%（小于死区 2%）→ 不动窗口，避免手指抖动把窗口来回抖
  const dead = moveGesture(start.state, [at(PAD_L + 99.5, 100), at(PAD_L + 200.5, 100)], cfg)
  assert.equal(dead.action, null, '指距抖动在死区内 → 不重绘')
})

test('查看数据途中落下第二根手指：切换为捏合（用当前窗口重新起算）', () => {
  const cfg = config()
  const start = beginGesture([at(PAD_L + 200)], cfg)
  const moved = moveGesture(start.state, [at(PAD_L + 150)], cfg)
  assert.equal(moved.action?.kind, 'crosshair', '单指阶段只是读数')
  const twoFingers = moveGesture(moved.state, [at(PAD_L + 140, 100), at(PAD_L + 240, 100)], cfg)
  assert.equal(twoFingers.action?.kind, 'clear')
  assert.equal(twoFingers.state?.mode, 'pinch')
  assert.equal(
    twoFingers.state?.base.viewEnd,
    TOTAL - 1,
    '捏合基准用当前 props 窗口（组件传入的是最新窗口）',
  )
})

test('分时 / 五日（zoomable=false）：捏合不改窗口，只出十字光标', () => {
  const cfg = config({ zoomable: false })
  assert.equal(beginGesture([at(PAD_L + 100), at(PAD_L + 200)], cfg).action?.kind, 'crosshair')
  const start = beginGesture([at(PAD_L + 200)], cfg)
  const moved = moveGesture(start.state, [at(PAD_L + 20)], cfg)
  assert.equal(moved.action?.kind, 'crosshair')
})

test('数据太短（根数 ≤ 最小窗口）：捏合不改窗口', () => {
  const cfg = config({ total: MIN_VIEW_BARS, viewport: defaultViewport(MIN_VIEW_BARS) })
  const start = beginGesture([at(PAD_L + 100, 100), at(PAD_L + 200, 100)], cfg)
  const moved = moveGesture(start.state, [at(PAD_L + 50, 100), at(PAD_L + 250, 100)], cfg)
  assert.equal(moved.action, null, '根数已是最小窗口 → 不再缩放')
})

test('手势结束：捏合途中松开一根手指作废本次手势，全部抬起才收起十字光标', () => {
  assert.deepEqual(endGesture(1), { state: null, action: null })
  assert.deepEqual(endGesture(0), { state: null, action: { kind: 'clear' } })
})

test('缺坐标时缺省用 clientX - rectLeft 换算（无 canvas 相对坐标的运行时）', () => {
  const cfg = config()
  const withClientOnly: GestureTouch[] = [{ clientX: RECT_LEFT + PAD_L + 100, clientY: 120 }]
  const start = beginGesture(withClientOnly, cfg)
  assert.equal(start.action?.kind, 'crosshair')
  if (start.action?.kind === 'crosshair') assert.equal(start.action.x, PAD_L + 100)
})

test('gesturePoint 系列在触摸点缺失时安全退化（返回 null / 0 指距）', () => {
  const cfg = config()
  const start = beginGesture([], cfg)
  assert.equal(start.action, null)
  const pinch = beginGesture([at(PAD_L + 100, 100), at(PAD_L + 200)], cfg)
  const state = pinch.state as GestureState
  const moved = moveGesture(state, [at(PAD_L + 100, 100)], cfg)
  assert.equal(moved.action, null, '捏合中只剩一根手指 → 不动作')
})
