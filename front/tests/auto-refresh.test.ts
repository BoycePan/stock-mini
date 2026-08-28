import assert from 'node:assert/strict'
import test, { mock } from 'node:test'

import {
  isPageLoading,
  isPageVisible,
  startAutoRefresh,
  stopAutoRefresh,
} from '../utils/auto-refresh.ts'

test('isPageLoading: 优先调用 isLoading，缺省时回退到 data.loading', () => {
  const pageWithFn = {
    data: { loading: false },
    isLoading: () => true,
    loadData: async () => {},
  }
  assert.equal(isPageLoading(pageWithFn), true)

  const pageWithData = {
    data: { loading: true },
    loadData: async () => {},
  }
  assert.equal(isPageLoading(pageWithData), true)

  const pageEmpty = {
    loadData: async () => {},
  }
  assert.equal(isPageLoading(pageEmpty), false)
})

test('startAutoRefresh: 处于 loading 中时不触发 onShow 立即补刷', () => {
  let called = false
  const page = {
    data: { loading: true },
    loadData: async () => {
      called = true
    },
  }
  // 距上次请求已超 10s，但由于在 loading，不应触发补刷
  startAutoRefresh(page, Date.now() - 10000)
  assert.equal(called, false)
  stopAutoRefresh(page)
})

test('startAutoRefresh: 距上次请求超过 5s 且非 loading 时立即发起 silent 刷新', () => {
  let called = false
  let callOptions: { silent?: boolean } | undefined
  const page = {
    data: { loading: false },
    loadData: async (opts?: { silent?: boolean }) => {
      called = true
      callOptions = opts
    },
  }
  startAutoRefresh(page, Date.now() - 6000)
  assert.equal(called, true)
  assert.deepEqual(callOptions, { silent: true })
  stopAutoRefresh(page)
})

test('startAutoRefresh: 距上次请求不足 5s 时不发起 onShow 补刷', () => {
  let called = false
  const page = {
    data: { loading: false },
    loadData: async () => {
      called = true
    },
  }
  startAutoRefresh(page, Date.now() - 1000)
  assert.equal(called, false)
  stopAutoRefresh(page)
})

test('startAutoRefresh: 同一页面重复调用不叠加轮询定时器（onShow 幂等）', () => {
  mock.timers.enable({ apis: ['setInterval'] })
  let tickCount = 0
  const page = {
    data: { loading: false },
    loadData: async () => {
      tickCount++
    },
  }
  const now = Date.now()
  // 模拟 onShow 反复触发（无 onHide 场景）：每次 start 应先停旧表再开新表
  startAutoRefresh(page, now)
  startAutoRefresh(page, now)
  startAutoRefresh(page, now)
  mock.timers.tick(10000)
  // 只应存在 1 个定时器：一个周期只触发 1 次刷新
  assert.equal(tickCount, 1)
  mock.timers.tick(10000)
  assert.equal(tickCount, 2)
  stopAutoRefresh(page)
  mock.timers.reset()
})

test('isPageVisible: 未提供 isCurrentPage 时视为始终可见（既有调用方行为不变）', () => {
  const page = { loadData: async () => {} }
  assert.equal(isPageVisible(page), true)
})

test('isPageVisible: 提供 isCurrentPage 时以其返回值判定页面是否可见', () => {
  const pageHidden = { isCurrentPage: () => false, loadData: async () => {} }
  const pageShown = { isCurrentPage: () => true, loadData: async () => {} }
  assert.equal(isPageVisible(pageHidden), false)
  assert.equal(isPageVisible(pageShown), true)
})

test('startAutoRefresh: isCurrentPage 为 false（页面不可见）时不发起 onShow 补刷', () => {
  let called = false
  const page = {
    data: { loading: false },
    isCurrentPage: () => false,
    loadData: async () => {
      called = true
    },
  }
  // 距上次请求已超 10s，但页面不可见（onHide 未触发 / 栈顶已被其他页占用），不应补刷
  startAutoRefresh(page, Date.now() - 10000)
  assert.equal(called, false)
  stopAutoRefresh(page)
})

test('startAutoRefresh: isCurrentPage 为 false 时轮询 tick 不再发起请求（页面切走的兜底保证）', () => {
  mock.timers.enable({ apis: ['setInterval'] })
  let tickCount = 0
  const page = {
    data: { loading: false },
    isCurrentPage: () => false,
    loadData: async () => {
      tickCount++
    },
  }
  startAutoRefresh(page, Date.now())
  mock.timers.tick(20000)
  assert.equal(tickCount, 0)
  stopAutoRefresh(page)
  mock.timers.reset()
})

test('startAutoRefresh: isCurrentPage 为 true（页面可见）时轮询正常触发', () => {
  mock.timers.enable({ apis: ['setInterval'] })
  let tickCount = 0
  const page = {
    data: { loading: false },
    isCurrentPage: () => true,
    loadData: async () => {
      tickCount++
    },
  }
  startAutoRefresh(page, Date.now())
  mock.timers.tick(10000)
  assert.equal(tickCount, 1)
  stopAutoRefresh(page)
  mock.timers.reset()
})

test('startAutoRefresh/stopAutoRefresh: 页面离开停止轮询，再次 onShow 重新开始', () => {
  mock.timers.enable({ apis: ['setInterval'] })
  let tickCount = 0
  const page = {
    data: { loading: false },
    loadData: async () => {
      tickCount++
    },
  }
  const now = Date.now()
  // onShow：开始轮询
  startAutoRefresh(page, now)
  // onHide：停止轮询，此后不再产生请求
  stopAutoRefresh(page)
  mock.timers.tick(10000)
  assert.equal(tickCount, 0)
  // 再次 onShow：重新开始轮询，恢复 10s 间隔
  startAutoRefresh(page, now)
  mock.timers.tick(10000)
  assert.equal(tickCount, 1)
  stopAutoRefresh(page)
  mock.timers.reset()
})
