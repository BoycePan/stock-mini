import assert from 'node:assert/strict'
import test from 'node:test'

import { isPageLoading, startAutoRefresh, stopAutoRefresh } from '../utils/auto-refresh.ts'

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
