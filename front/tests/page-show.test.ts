import assert from 'node:assert/strict'
import test from 'node:test'

import {
  MARK_TTL_MS,
  markAppForeground,
  markTabSwitch,
  resolvePageShowReason,
  __resetPageShowForTest,
} from '../utils/page-show.ts'

/**
 * 页面显示原因判定（utils/page-show.ts）：插屏「从子页面返回不展示 / 切 tab 展示」的依据。
 *
 * 判定 = 实例是否显示过（首次 → `enter`）+ 两个一次性意图标记（切 tab / 回前台）；
 * 都靠不住时归为 `return`（保守不展示）。时间统一用显式 now 传入，不依赖真实时钟。
 */

const T0 = 1_700_000_000_000

test.beforeEach(() => {
  __resetPageShowForTest()
})

test('首次显示：新页面实例一律 enter（冷启动 / 首次切 tab / navigateTo 进子页面）', () => {
  const page = {}
  assert.equal(resolvePageShowReason('global', page, T0), 'enter')
})

test('再次显示且无任何意图标记：return（从子页面返回的核心场景）', () => {
  const page = {}
  resolvePageShowReason('global', page, T0)
  assert.equal(resolvePageShowReason('global', page, T0 + 100), 'return')
  // 反复 onShow 依旧是 return（返回后停留、再返回同样不展示）
  assert.equal(resolvePageShowReason('global', page, T0 + 200), 'return')
})

test('切 tab 标记 + 目标页一致：tab-switch', () => {
  const page = {}
  resolvePageShowReason('global', page, T0)
  markTabSwitch('global', T0 + 50)
  assert.equal(resolvePageShowReason('global', page, T0 + 100), 'tab-switch')
})

test('切 tab 标记只对目标页生效：其他页面的再次显示仍是 return', () => {
  const page = {}
  resolvePageShowReason('global', page, T0)
  markTabSwitch('asia', T0 + 50)
  assert.equal(resolvePageShowReason('global', page, T0 + 100), 'return')
})

test('切 tab 标记被消费一次即失效：紧接着的再次显示回到 return', () => {
  const page = {}
  resolvePageShowReason('global', page, T0)
  markTabSwitch('global', T0 + 50)
  assert.equal(resolvePageShowReason('global', page, T0 + 100), 'tab-switch')
  assert.equal(resolvePageShowReason('global', page, T0 + 110), 'return')
})

test('切 tab 标记超时（TTL）后失效：陈留标记不会把返回误判成可展示', () => {
  const page = {}
  resolvePageShowReason('global', page, T0)
  markTabSwitch('global', T0 + 50)
  assert.equal(resolvePageShowReason('global', page, T0 + 50 + MARK_TTL_MS + 1), 'return')
})

test('App 回前台标记：再次显示判定为 app-foreground（与 return 区分开）', () => {
  const page = {}
  resolvePageShowReason('global', page, T0)
  markAppForeground(T0 + 50)
  assert.equal(resolvePageShowReason('global', page, T0 + 100), 'app-foreground')
})

test('App 回前台标记超时后失效', () => {
  const page = {}
  resolvePageShowReason('global', page, T0)
  markAppForeground(T0 + 50)
  assert.equal(resolvePageShowReason('global', page, T0 + 50 + MARK_TTL_MS + 1), 'return')
})

test('首次显示优先于意图标记：不会把首屏误判成 tab-switch / app-foreground', () => {
  const page = {}
  markTabSwitch('global', T0)
  markAppForeground(T0)
  assert.equal(resolvePageShowReason('global', page, T0), 'enter')
})

test('首次显示时也消费意图标记：陈留标记不会影响该页下一次显示', () => {
  const page = {}
  // 冷启动 App.onShow（回前台标记）、或用户先点了别的 tab，都会留下标记
  markAppForeground(T0)
  markTabSwitch('finance', T0)
  assert.equal(resolvePageShowReason('global', page, T0), 'enter')
  // 下一次（从子页面返回）必须仍是 return，不能被上面两个标记救活
  assert.equal(resolvePageShowReason('global', page, T0 + 10), 'return')
})

test('实例标记互相独立：新实例即使紧邻旧实例的显示也是 enter', () => {
  const first = {}
  const second = {}
  assert.equal(resolvePageShowReason('global', first, T0), 'enter')
  assert.equal(resolvePageShowReason('global', second, T0 + 1), 'enter')
  assert.equal(resolvePageShowReason('global', first, T0 + 2), 'return')
})
