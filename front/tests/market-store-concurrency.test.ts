import assert from 'node:assert/strict'
import test from 'node:test'

import type { MarketPageData } from '../types/market.ts'

/**
 * MarketStore 并发/状态语义回归（不依赖真实接口：直接替换 marketApi.getPage）。
 *
 * 覆盖两处历史缺陷：
 * 1. errors 只在「非静默请求开始」时清空，成功分支从不清空 → 一次失败后，8s 静默自动
 *    刷新即使成功拿到新数据，页面模板的 `wx:elif="{{error}}"` 仍整页显示「重新加载」，
 *    数据被陈旧错误串挡在渲染分支外且不会自愈；
 * 2. 下拉刷新（force）会命中在途的 **静默** 请求并复用它，而静默请求失败不写 errors，
 *    于是调用方误判为「刷新成功」并向用户提示「已更新」；
 *    并行时的落库顺序另由 requestSeq 保证「最新一次发起者胜出」。
 */

/** 最小 wx mock：仅为让模块加载期读取 env / storage 不抛错 */
function installWx(): void {
  ;(globalThis as Record<string, unknown>).wx = {
    getStorageSync: () => '',
    setStorageSync: () => undefined,
    removeStorageSync: () => undefined,
    getDeviceInfo: () => ({ platform: 'devtools' }),
    getAccountInfoSync: () => ({
      miniProgram: { version: '1.0.0', envVersion: 'develop', appId: 'wx-test' },
    }),
    request: () => undefined,
    setBackgroundColor: () => undefined,
    setBackgroundTextStyle: () => undefined,
    setNavigationBarColor: () => undefined,
  }
  ;(globalThis as Record<string, unknown>).getCurrentPages = () => []
}

installWx()

const { MarketStore } = await import('../stores/market.store.ts')
const { marketApi } = await import('../api/market.ts')

interface Deferred<T> {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (error: Error) => void
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function pageData(tag: string): MarketPageData {
  return { statusLabel: tag, statusTone: 'active', updatedLabel: tag, sections: [] }
}

/** 替换 marketApi.getPage，返回「每次调用的 deferred 列表」以便精确控制响应顺序 */
function stubGetPage(): Array<Deferred<MarketPageData>> {
  const calls: Array<Deferred<MarketPageData>> = []
  const original = marketApi.getPage
  marketApi.getPage = (() => {
    const d = deferred<MarketPageData>()
    calls.push(d)
    return d.promise
  }) as typeof marketApi.getPage
  // 用例结束后由调用方恢复（见各用例 finally）
  test.after(() => {
    marketApi.getPage = original
  })
  return calls
}

test('成功响应会清空 errors：静默刷新成功后不再残留错误态', async () => {
  const calls = stubGetPage()
  const store = new MarketStore()

  // ① 首次非静默加载失败 → 写入 errors
  const first = store.loadPage('global')
  calls[0]!.reject(new Error('网络异常'))
  await assert.rejects(first)
  assert.equal(store.errors.global, '网络异常')
  assert.equal(store.loading.global, false, '失败后必须复位 loading')

  // ② 静默自动刷新成功 → 必须清空错误态（否则页面永远停在「重新加载」卡片）
  const second = store.loadPage('global', { force: true, silent: true })
  calls[1]!.resolve(pageData('新数据'))
  await second
  assert.equal(store.errors.global, '', '成功后 errors 必须清空')
  assert.equal(store.pages.global?.statusLabel, '新数据')
})

test('静默请求失败不写 errors（不打扰用户），非静默失败才写', async () => {
  const calls = stubGetPage()
  const store = new MarketStore()

  const silent = store.loadPage('asia', { force: true, silent: true })
  calls[0]!.reject(new Error('boom'))
  await assert.rejects(silent)
  assert.equal(store.errors.asia, '', '静默失败不写错误态')
  assert.equal(store.loading.asia, false)

  const loud = store.loadPage('asia', { force: true })
  calls[1]!.reject(new Error('boom2'))
  await assert.rejects(loud)
  assert.equal(store.errors.asia, 'boom2', '非静默失败写入错误态')
})

test('force 下拉刷新不被在途的静默请求吞掉：会真正发起新请求', async () => {
  const calls = stubGetPage()
  const store = new MarketStore()

  // 静默轮询在途（silent=true，不置 loading）
  const silent = store.loadPage('metals', { force: true, silent: true })
  assert.equal(calls.length, 1)

  // 用户此刻下拉刷新：force 不复用静默在途请求，必须再发一次
  const pull = store.loadPage('metals', { force: true })
  assert.equal(calls.length, 2, 'force 应发起新请求而不是复用静默在途请求')

  // 静默先返回（旧），force 后返回（新）→ 最终数据应为最新一次发起的请求结果
  calls[0]!.resolve(pageData('静默结果'))
  await silent
  calls[1]!.resolve(pageData('下拉结果'))
  await pull

  assert.equal(store.pages.metals?.statusLabel, '下拉结果')
  assert.equal(store.loading.metals, false)
  assert.equal(store.errors.metals, '')
})

test('requestSeq：先发起的旧响应后返回时不覆盖新数据', async () => {
  const calls = stubGetPage()
  const store = new MarketStore()

  const older = store.loadPage('finance', { force: true, silent: true })
  const newer = store.loadPage('finance', { force: true })
  assert.equal(calls.length, 2)

  // 新请求先返回
  calls[1]!.resolve(pageData('较新'))
  await newer
  assert.equal(store.pages.finance?.statusLabel, '较新')

  // 旧请求后返回：不得覆盖
  calls[0]!.resolve(pageData('较旧'))
  await older
  assert.equal(store.pages.finance?.statusLabel, '较新', '过期响应不覆盖新数据')
})

test('并发去重：非 force 的重复调用复用同一在途请求（不重复发接口）', async () => {
  const calls = stubGetPage()
  const store = new MarketStore()

  const a = store.loadPage('global')
  const b = store.loadPage('global')
  assert.equal(calls.length, 1, '同页非 force 并发应复用同一请求')

  calls[0]!.resolve(pageData('唯一'))
  const [ra, rb] = await Promise.all([a, b])
  assert.equal(ra.statusLabel, '唯一')
  assert.equal(rb.statusLabel, '唯一')
  assert.deepEqual(
    store.inFlight,
    {},
    '请求结束后 inFlight 必须清空（否则后续加载复用陈旧 Promise）',
  )
})
