import assert from 'node:assert/strict'
import test from 'node:test'

import {
  getApiBaseUrl,
  getEnvOverride,
  getFinanceCache,
  getNewsDetail,
  getSearchHistory,
  getThemePreference,
  getToken,
  getUser,
} from '../utils/storage.ts'

/**
 * 注入最小 wx storage mock：getStorageSync 对不存在的键返回空字符串，
 * 与微信真实行为一致（utils/storage.ts 的 read 以「空串 = 缺失」为约定）。
 */
function setWxStorage(store: Record<string, unknown>): void {
  ;(globalThis as Record<string, unknown>).wx = {
    getStorageSync: (key: string) => store[key] ?? '',
    setStorageSync: () => {},
    removeStorageSync: () => {},
  }
}

function clearWxStorage(): void {
  ;(globalThis as Record<string, unknown>).wx = undefined
}

test('read（经各 getter）：键缺失时回退 fallback（wx 对不存在的键返回空串）', () => {
  setWxStorage({})
  assert.equal(getToken(), '')
  assert.equal(getUser(), null)
  assert.equal(getThemePreference(), 'system')
  assert.equal(getApiBaseUrl(), '')
  assert.equal(getEnvOverride(), null)
  assert.equal(getNewsDetail(), null)
  assert.equal(getFinanceCache(), null)
  assert.deepEqual(getSearchHistory(), [])
  clearWxStorage()
})

test('read：读取异常时回退 fallback（storage 不可用不抛错）', () => {
  ;(globalThis as Record<string, unknown>).wx = {
    getStorageSync: () => {
      throw new Error('storage down')
    },
  }
  assert.equal(getToken(), '')
  assert.equal(getUser(), null)
  assert.equal(getThemePreference(), 'system')
  assert.deepEqual(getSearchHistory(), [])
  clearWxStorage()
})

test('read：合法假值 0 / false 原样读出，不再被 fallback 覆盖', () => {
  // 旧实现 `value || fallback` 会把 0 / false 也替换成 fallback（null），
  // 现在只在「缺失（空串 / null / undefined）」时回退。
  setWxStorage({ market_tracker_user: 0 })
  assert.equal(getUser(), 0)
  setWxStorage({ market_tracker_user: false })
  assert.equal(getUser(), false)
  setWxStorage({ market_tracker_user: '' })
  assert.equal(getUser(), null, '空串仍按「缺失」处理（本仓库约定）')
  clearWxStorage()
})

test('read：环境值 / 主题偏好等非法值仍被各自的校验兜住', () => {
  setWxStorage({ market_tracker_env_override: 0, market_tracker_theme: false })
  assert.equal(getEnvOverride(), null, '0 不是合法环境值')
  assert.equal(getThemePreference(), 'system', 'false 不是合法主题偏好')
  setWxStorage({ market_tracker_env_override: 'local', market_tracker_theme: 'dark' })
  assert.equal(getEnvOverride(), 'local')
  assert.equal(getThemePreference(), 'dark')
  clearWxStorage()
})

test('read：搜索记录非数组 / 含非字符串项时仍做过滤（既有语义不变）', () => {
  setWxStorage({ market_tracker_search_history: 'garbage' })
  assert.deepEqual(getSearchHistory(), [])
  setWxStorage({ market_tracker_search_history: ['a', 1, null, 'b'] })
  assert.deepEqual(getSearchHistory(), ['a', 'b'])
  clearWxStorage()
})

test('read：对象 / 数组等真值原样读出（与旧实现一致）', () => {
  const detail = { title: 't', summary: 's', url: 'u', source: 'src', time: '2026-08-30' }
  setWxStorage({ market_tracker_news_detail: detail })
  assert.deepEqual(getNewsDetail(), detail)
  setWxStorage({ market_tracker_finance_cache: { statusLabel: 'x' } })
  assert.deepEqual(getFinanceCache(), { statusLabel: 'x' })
  clearWxStorage()
})
