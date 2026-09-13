import assert from 'node:assert/strict'
import test from 'node:test'

import { INTERSTITIAL_AD_CONFIG, type InterstitialLocation } from '../config/interstitial-ad.ts'
import { rootStore } from '../stores/root.store.ts'
import type { AdConfig } from '../types/system.ts'
import { maybeShowInterstitial } from '../utils/interstitial-ad.ts'
import { markAppForeground, markTabSwitch, __resetPageShowForTest } from '../utils/page-show.ts'
import {
  INTERSTITIAL_DAILY_KEY,
  INTERSTITIAL_LAST_SHOW_KEY,
} from '../utils/interstitial-frequency.ts'

/**
 * 插屏调度器（utils/interstitial-ad.ts）回归，三个维度：
 *
 * 一、全局单飞锁的**释放路径** —— 锁泄漏后 state 停在 loading / showing 不再回到 idle，
 * 本次会话所有页面的插屏都会被闸门 2 静默丢弃，从日志上看只是反复「已有插屏在加载/展示」：
 * 1. `wx.createInterstitialAd` 同步抛错（adUnitId 非法）或返回非法实例时，创建过程原先没有
 *    try/catch，异常会冒泡到页面 onShow，且没有任何路径把 state 改回 idle；
 * 2. 展示成功（state='showing'，已计入当日次数）后到达的 onError，原先会走重试分支：
 *    既 destroy 掉正在展示的实例，又因 startAttempt 重置 shownInRun 而重复计数同一流程。
 *
 * 二、**触发时机**（闸门 0，判定逻辑见 utils/page-show.ts，纯函数单测在 page-show.test.ts）：
 * 从子页面返回不展示、用户切 tab 展示——这里验证它在调度器里真正拦得住 / 放得行。
 *
 * 三、**远端广告位配置**（adConfig.interstitialAd，解析纯函数单测在 ad-config.test.ts）：
 * 未配置 / status=false 不展示；配置未就绪（冷启动竞态）时挂起本次触发，
 * 配置到达即补一次展示。
 *
 * 「页面实例」用 `{}` 充当：判定只看「该实例是否显示过」与意图标记，与页面真实结构无关；
 * 每个「不同页面」用全新对象，同一页面重复显示则复用同一对象（这正是判定依据）。
 */

const DEFAULT_CONFIG = { ...INTERSTITIAL_AD_CONFIG }

/** 远端下发的插屏广告位（模拟后端 app_config adConfig.interstitialAd；测试内手动「下发」） */
const GLOBAL: InterstitialLocation = 'global'
const REMOTE_INTERSTITIAL = [
  { 'unit-id': 'adunit-interstitial-mock', location: GLOBAL, status: true },
]

/** 远端下发的插屏行为参数（adConfig.interstitialConfig，逐项覆盖本地默认值） */
type RemoteSettings = NonNullable<AdConfig['interstitialConfig']>

/**
 * 模拟远端配置下发（写 rootStore.system.configs / ready，与 SystemStore.fetchAll 一致）：
 * @param entries  adConfig.interstitialAd 条目（默认 global 一条启用）
 * @param ready    display 配置是否已拉取完成（false = 冷启动配置还没到）
 * @param settings adConfig.interstitialConfig 行为参数（默认不配 = 全用本地默认值）
 */
function setRemoteConfig(
  entries: Array<{ 'unit-id': string; location: string; status: boolean }> = REMOTE_INTERSTITIAL,
  ready = true,
  settings?: RemoteSettings,
): void {
  rootStore.system.ready = ready
  rootStore.system.configs = {
    adConfig: { interstitialAd: entries, interstitialConfig: settings },
  }
}

/** 清掉远端配置（模拟后台未配置 / 退出登录后的会话） */
function clearRemoteConfig(): void {
  rootStore.system.ready = false
  rootStore.system.configs = {}
}

test.beforeEach(() => {
  // 意图标记（切 tab / 回前台）是一次性消费的，逐用例清空，避免 TTL 内串味
  __resetPageShowForTest()
  setRemoteConfig()
})

test.afterEach(() => {
  clearRemoteConfig()
})

/** 测试参数：关掉 15s 展示间隔与失败重试的真实等待，避免用例串行变慢 */
function setConfig(patch: Partial<typeof INTERSTITIAL_AD_CONFIG>): void {
  Object.assign(INTERSTITIAL_AD_CONFIG, patch)
}

test.after(() => {
  Object.assign(INTERSTITIAL_AD_CONFIG, DEFAULT_CONFIG)
})

/** 可脚本化的插屏实例 mock：事件回调由测试手动触发，记录 destroy 次数 */
interface FakeAd {
  fireLoad(): void
  fireError(error?: unknown): void
  fireClose(): void
  readonly destroyCount: number
}

function createFakeAd(): { ad: Record<string, unknown>; fake: FakeAd } {
  const handlers: { load?: () => void; error?: (error: unknown) => void; close?: () => void } = {}
  let destroyCount = 0
  const ad = {
    onLoad: (callback: () => void) => {
      handlers.load = callback
    },
    onError: (callback: (error: unknown) => void) => {
      handlers.error = callback
    },
    onClose: (callback: () => void) => {
      handlers.close = callback
    },
    show: () => Promise.resolve(),
    destroy: () => {
      destroyCount += 1
    },
  }
  return {
    ad,
    fake: {
      fireLoad: () => handlers.load?.(),
      fireError: (error?: unknown) => handlers.error?.(error ?? new Error('mock 加载失败')),
      fireClose: () => handlers.close?.(),
      get destroyCount() {
        return destroyCount
      },
    },
  }
}

/** createInterstitialAd 的行为：正常 / 同步抛错 / 返回缺少事件方法的非法实例 */
type CreateBehavior = 'ok' | 'throw' | 'invalid'

/** 安装 wx mock：storage 走内存记录（与真实一致：缺失键返回空串），广告实例可脚本化触发 */
function installWx(behavior: CreateBehavior = 'ok') {
  const store: Record<string, unknown> = {}
  const created: FakeAd[] = []
  let createCount = 0
  ;(globalThis as Record<string, unknown>).wx = {
    getStorageSync: (key: string) => (key in store ? store[key] : ''),
    setStorageSync: (key: string, value: unknown) => {
      store[key] = value
    },
    removeStorageSync: (key: string) => {
      delete store[key]
    },
    canIUse: () => true,
    onAppHide: () => undefined,
    onAppShow: () => undefined,
    createInterstitialAd: () => {
      createCount += 1
      if (behavior === 'throw') throw new Error('adUnitId 非法')
      if (behavior === 'invalid') return {}
      const { ad, fake } = createFakeAd()
      created.push(fake)
      return ad
    },
  }
  return {
    store,
    created,
    get createCount() {
      return createCount
    },
  }
}

/**
 * 取第 index 个被创建的实例。
 * tsconfig 开了 noUncheckedIndexedAccess：下标访问结果是 T | undefined，这里统一断言收窄。
 */
function createdAd(wxMock: { created: FakeAd[] }, index: number): FakeAd {
  const ad = wxMock.created[index]
  assert.ok(ad, `期望已创建第 ${index + 1} 个插屏实例`)
  return ad
}

/** 本地缓存的「今日已展示次数」（跨天 / 缺记录按 0） */
function dailyShownCount(store: Record<string, unknown>): number {
  const state = store[INTERSTITIAL_DAILY_KEY] as { count?: number } | undefined
  return typeof state?.count === 'number' ? state.count : 0
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0))
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** 走完一次「展示成功 → 用户关闭」，让全局锁回到 idle */
async function finishShown(wxMock: { created: FakeAd[] }, index: number): Promise<void> {
  createdAd(wxMock, index).fireLoad()
  await tick()
  createdAd(wxMock, index).fireClose()
  await tick()
}

// ---------------------------------------------------------------------------
// 一：创建实例异常不得冒泡、不得占锁
// ---------------------------------------------------------------------------

test('创建实例同步抛错：不冒泡到调用方，且释放全局锁', () => {
  setConfig({ maxAttempts: 1, retryIntervalMs: 5, minIntervalMs: 0 })
  const wxMock = installWx('throw')

  // 两个不同的页面实例 = 两次「首次显示」，与真实场景（另一页随后显示）一致
  assert.doesNotThrow(() => maybeShowInterstitial(GLOBAL, {}), '创建异常不应冒泡到页面 onShow')
  assert.equal(wxMock.createCount, 1)

  // 锁已释放的证据：另一次首次显示能重新进入创建流程。
  // 若 state 卡在 loading，本次触发会被闸门 2（全局单飞）丢弃 → createCount 停在 1。
  assert.doesNotThrow(() => maybeShowInterstitial(GLOBAL, {}))
  assert.equal(wxMock.createCount, 2, '全局锁未释放：后续触发被全局单飞闸门拦掉')
})

test('createInterstitialAd 返回非法实例：不抛 TypeError，且释放全局锁', () => {
  setConfig({ maxAttempts: 1, retryIntervalMs: 5, minIntervalMs: 0 })
  const wxMock = installWx('invalid')

  assert.doesNotThrow(() => maybeShowInterstitial(GLOBAL, {}))
  assert.equal(wxMock.createCount, 1)
  assert.doesNotThrow(() => maybeShowInterstitial(GLOBAL, {}))
  assert.equal(wxMock.createCount, 2, '全局锁未释放：后续触发被全局单飞闸门拦掉')
})

// ---------------------------------------------------------------------------
// 二：正常失败重试路径必须保留（修复不能误伤 onError 重试）
// ---------------------------------------------------------------------------

test('单次加载失败仍按 maxAttempts 重试，第二次尝试成功展示并计数 1', async () => {
  setConfig({ maxAttempts: 3, retryIntervalMs: 5, minIntervalMs: 0 })
  const wxMock = installWx()

  maybeShowInterstitial(GLOBAL, {})
  assert.equal(wxMock.created.length, 1)

  createdAd(wxMock, 0).fireError(new Error('mock 加载失败'))
  await sleep(50) // ≫ retryIntervalMs
  assert.equal(wxMock.created.length, 2, '未达 maxAttempts 时应重建实例重试')

  createdAd(wxMock, 1).fireLoad()
  await tick()
  assert.equal(dailyShownCount(wxMock.store), 1, '重试后展示成功应计入 1 次')
  assert.equal(typeof wxMock.store[INTERSTITIAL_LAST_SHOW_KEY], 'number')

  // onClose 收尾并释放锁：另一个页面随后的首次显示可重新创建
  createdAd(wxMock, 1).fireClose()
  await tick()
  maybeShowInterstitial(GLOBAL, {})
  assert.equal(wxMock.created.length, 3)

  // 收尾最后一个在途流程，避免看门狗 / 全局锁残留影响后续用例
  createdAd(wxMock, 2).fireClose()
  await tick()
})

// ---------------------------------------------------------------------------
// 三：展示成功后迟到的失败回调不得重试（不销毁在展示中的实例、不重复计数）
// ---------------------------------------------------------------------------

test('展示成功后到达的 onError：不重试、不销毁在展示中的实例、不重复计数', async () => {
  setConfig({ maxAttempts: 3, retryIntervalMs: 5, minIntervalMs: 0 })
  const wxMock = installWx()

  maybeShowInterstitial(GLOBAL, {})
  const shown = createdAd(wxMock, 0)
  shown.fireLoad()
  await tick()
  assert.equal(dailyShownCount(wxMock.store), 1, '展示成功应计入 1 次')

  // 展示成功后（state='showing'）到达的失败回调
  shown.fireError(new Error('展示期错误'))
  await sleep(100) // ≫ retryIntervalMs：若仍调度了重试，这里必然已重建实例
  assert.equal(wxMock.created.length, 1, '展示成功后不应再重试创建实例')
  assert.equal(shown.destroyCount, 0, '正在展示的实例不应被销毁')
  assert.equal(dailyShownCount(wxMock.store), 1, '同一次流程只计一次数')

  // 仍由 onClose 收尾释放锁
  shown.fireClose()
  await tick()
  maybeShowInterstitial(GLOBAL, {})
  assert.equal(wxMock.created.length, 2, 'onClose 后锁应释放')
  createdAd(wxMock, 1).fireClose()
  await tick()
})

// ---------------------------------------------------------------------------
// 四：全局单飞仍然生效（并发触发只放行一次）
// ---------------------------------------------------------------------------

test('加载中重复触发被全局单飞闸门丢弃，不产生第二个实例', async () => {
  setConfig({ maxAttempts: 3, retryIntervalMs: 5, minIntervalMs: 0 })
  const wxMock = installWx()

  maybeShowInterstitial(GLOBAL, {})
  maybeShowInterstitial(GLOBAL, {})
  maybeShowInterstitial(GLOBAL, {})
  assert.equal(wxMock.createCount, 1, '同一时刻只允许一个插屏创建/加载/展示')

  await finishShown(wxMock, 0)
})

// ---------------------------------------------------------------------------
// 五：触发时机（闸门 0）——从子页面返回不展示，切 tab 展示
// ---------------------------------------------------------------------------

test('从子页面返回（同一页面实例再次显示）不触发插屏', async () => {
  setConfig({ maxAttempts: 3, retryIntervalMs: 5, minIntervalMs: 0 })
  const wxMock = installWx()
  const page = {}

  // 首次进页面（详情页/列表页的 onLoad 后首次显示）→ 允许展示
  maybeShowInterstitial(GLOBAL, page)
  assert.equal(wxMock.createCount, 1)
  await finishShown(wxMock, 0)

  // 从子页面返回：同一实例再次 onShow，且没有切 tab / 回前台标记 → 不展示。
  // 注意 minIntervalMs=0、当日次数也未达上限，能拦住它的只有闸门 0
  maybeShowInterstitial(GLOBAL, page)
  assert.equal(wxMock.createCount, 1, '从子页面返回不应触发插屏')
  assert.equal(wxMock.created.length, 1)
})

test('用户点 tabBar 切 tab 回到该页面：仍可触发插屏', async () => {
  setConfig({ maxAttempts: 3, retryIntervalMs: 5, minIntervalMs: 0 })
  const wxMock = installWx()
  const page = {}

  maybeShowInterstitial(GLOBAL, page)
  await finishShown(wxMock, 0)

  // 切 tab：custom-tab-bar 在 wx.switchTab 前打标（key 与页面 location 同名）
  markTabSwitch(GLOBAL)
  maybeShowInterstitial(GLOBAL, page)
  assert.equal(wxMock.createCount, 2, '切 tab 应允许展示')
  await finishShown(wxMock, 1)
})

// ---------------------------------------------------------------------------
// 六：远端广告位配置（adConfig.interstitialAd）——未配置不展示、配置到达补展示
// ---------------------------------------------------------------------------

test('远端未配置该 location：不创建实例（未配置就不展示，无本地兜底）', () => {
  setConfig({ maxAttempts: 1, retryIntervalMs: 5, minIntervalMs: 0 })
  setRemoteConfig([]) // 后台没配任何插屏广告位
  const wxMock = installWx()

  maybeShowInterstitial(GLOBAL, {})
  assert.equal(wxMock.createCount, 0, '远端未配置该 location 时不应创建插屏实例')
})

test('远端 status=false：不创建实例（临时下线用）', () => {
  setConfig({ maxAttempts: 1, retryIntervalMs: 5, minIntervalMs: 0 })
  setRemoteConfig([{ 'unit-id': 'adunit-interstitial-mock', location: GLOBAL, status: false }])
  const wxMock = installWx()

  maybeShowInterstitial(GLOBAL, {})
  assert.equal(wxMock.createCount, 0, 'status=false 的插屏不应创建实例')
})

test('非 global 的 location 未配置：同样不展示（各页面独立配置）', () => {
  setConfig({ maxAttempts: 1, retryIntervalMs: 5, minIntervalMs: 0 })
  const wxMock = installWx()

  maybeShowInterstitial('news-detail', {})
  assert.equal(wxMock.createCount, 0, '只配了 global 时 news-detail 不应创建实例')
})

test('配置未就绪时挂起，配置到达后补一次展示', async () => {
  setConfig({ maxAttempts: 3, retryIntervalMs: 5, minIntervalMs: 0 })
  // 冷启动：页面 onShow 早于「登录 + 配置」返回（ready=false，interstitialAd 还没有）
  setRemoteConfig([], false)
  const wxMock = installWx()

  maybeShowInterstitial(GLOBAL, {})
  assert.equal(wxMock.createCount, 0, '配置未就绪时不应立即创建实例')

  // 配置到达（SystemStore.fetchAll 写回 configs + ready）
  setRemoteConfig()
  await tick()
  assert.equal(wxMock.createCount, 1, '配置到达后应补一次触发')

  await finishShown(wxMock, 0)
})

test('配置到达但该 location 仍未配置：超时前不展示，且不产生实例', async () => {
  setConfig({ maxAttempts: 3, retryIntervalMs: 5, minIntervalMs: 0, configWaitTimeoutMs: 20 })
  setRemoteConfig([], false)
  const wxMock = installWx()

  maybeShowInterstitial('news', {})
  // 配置到达，但没有 news 这个 location 的条目 → 解析结果始终为空，不会补展示
  setRemoteConfig()
  await sleep(60) // ≫ configWaitTimeoutMs
  assert.equal(wxMock.createCount, 0, '远端没有该 location 的插屏时不应展示')
})

test('等待配置期间页面已切走：放弃补展示（避免插屏弹在无关页面上）', async () => {
  setConfig({ maxAttempts: 3, retryIntervalMs: 5, minIntervalMs: 0 })
  setRemoteConfig([], false)
  const wxMock = installWx()
  const page = {}
  const otherPage = {}
  ;(globalThis as Record<string, unknown>).getCurrentPages = () => [otherPage]

  try {
    maybeShowInterstitial(GLOBAL, page)
    setRemoteConfig()
    await tick()
    assert.equal(wxMock.createCount, 0, '触发页已不是栈顶页时不应补展示')
  } finally {
    delete (globalThis as Record<string, unknown>).getCurrentPages
  }
})

// ---------------------------------------------------------------------------
// 七：远端行为参数（adConfig.interstitialConfig）——逐项覆盖本地默认值
// ---------------------------------------------------------------------------

test('远端 interstitialConfig.enabled=false（总开关）：任何触发都不展示', () => {
  setConfig({ maxAttempts: 1, retryIntervalMs: 5, minIntervalMs: 0 })
  setRemoteConfig(REMOTE_INTERSTITIAL, true, { enabled: false })
  const wxMock = installWx()

  maybeShowInterstitial(GLOBAL, {})
  assert.equal(wxMock.createCount, 0, '远端总开关关闭时不应创建插屏实例')
})

test('远端 dailyCap=1（老用户每日上限）：当日展示 1 次后不再展示', async () => {
  setConfig({ maxAttempts: 3, retryIntervalMs: 5, minIntervalMs: 0 })
  setRemoteConfig(REMOTE_INTERSTITIAL, true, { dailyCap: 1 })
  const wxMock = installWx()

  maybeShowInterstitial(GLOBAL, {})
  await finishShown(wxMock, 0)
  assert.equal(dailyShownCount(wxMock.store), 1)

  // 另一个页面实例的首次显示：minIntervalMs=0，能拦住的只有「远端下发的每日上限 1」
  maybeShowInterstitial(GLOBAL, {})
  assert.equal(wxMock.createCount, 1, '已达远端每日上限时不应再展示')
})

test('远端 showOnAppForeground=false：回前台不展示，首次进入仍展示', async () => {
  setConfig({ maxAttempts: 3, retryIntervalMs: 5, minIntervalMs: 0 })
  setRemoteConfig(REMOTE_INTERSTITIAL, true, { showOnAppForeground: false })
  const wxMock = installWx()
  const page = {}

  // 首次进入（onLoad 后首次 onShow）→ 展示
  maybeShowInterstitial(GLOBAL, page)
  assert.equal(wxMock.createCount, 1)
  await finishShown(wxMock, 0)

  // App 回前台 → 闸门 0 拦截（远端参数生效）
  markAppForeground()
  maybeShowInterstitial(GLOBAL, page)
  assert.equal(wxMock.createCount, 1, '远端关闭「回前台展示」时不应触发')

  // 远端改回 true（后台改配置即时生效）→ 回前台可展示
  setRemoteConfig(REMOTE_INTERSTITIAL, true, { showOnAppForeground: true })
  markAppForeground()
  maybeShowInterstitial(GLOBAL, page)
  assert.equal(wxMock.createCount, 2, '远端开启后回前台应可触发')
  await finishShown(wxMock, 1)
})

test('远端参数非法（字符串 / 负数）：回落本地默认值，不产生不限频等副作用', () => {
  setConfig({ maxAttempts: 1, retryIntervalMs: 5, minIntervalMs: 15 * 1000 })
  // minIntervalMs 传字符串、dailyCap 传负数：都应被忽略而用本地默认值
  setRemoteConfig(REMOTE_INTERSTITIAL, true, {
    minIntervalMs: '123' as unknown as number,
    dailyCap: -1,
  })
  const wxMock = installWx()

  // 本地默认 minIntervalMs=15s 生效：首次触发照常展示
  maybeShowInterstitial(GLOBAL, {})
  assert.equal(wxMock.createCount, 1, '非法参数不应影响正常展示')

  // 第二次触发（另一个页面实例）仍被 15s 间隔拦住——证明没退化成 minIntervalMs=0
  maybeShowInterstitial(GLOBAL, {})
  assert.equal(wxMock.createCount, 1, '非法 minIntervalMs 应回落默认 15s 间隔')

  createdAd(wxMock, 0).fireClose()
})
