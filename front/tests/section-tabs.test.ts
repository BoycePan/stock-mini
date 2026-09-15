import assert from 'node:assert/strict'
import test from 'node:test'

import type { MarketSection } from '../types/market.ts'
import { projectSectionTab } from '../utils/section-tabs.ts'

/** 最小 wx mock：MarketStore 模块加载期会读环境 / 存储，这里只需不抛错 */
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

/**
 * 面板内 Tab（首页「行业板块」A股 / 美股）的选中语义回归，覆盖：
 * 1. 进入页面默认选中 Tab 由**数据层的时段默认值**决定（api/market.ts 用
 *    utils/market-clock.ts resolveIndustrySource 判定：A股时段 → 'a'，美股时段 → 'us'）；
 * 2. 用户手动切换即时生效（stores/market.store.ts pickSectionTab → resolveSectionTab → 投影）；
 * 3. 时段口径翻转后手动选择自动失效，面板回到新的时段默认（避免停在过期的市场口径）；
 * 4. 投影只把选中 Tab 的指标 / 阶段胶囊 / 分时角标下发渲染层。
 */

/** 行业板块面板（双 Tab）测试数据：A股 Tab 大A盘中 + 分时角标；美股 Tab 美股盘后 + 无分时角标 */
function industryBoardSection(): MarketSection {
  return {
    id: 'industry-board',
    title: '行业板块',
    tone: 'global',
    singleLine: true,
    tip: 'tip',
    // 数据层给的时段默认：A股时段
    activeTab: 'a',
    metrics: [{ id: 'q-BK1134-0', name: 'AI算力', value: '', change: 1.5 }],
    marketStatus: '大A盘中',
    marketTone: 'active',
    minuteCorner: true,
    tabs: [
      {
        key: 'a',
        label: 'A股',
        metrics: [{ id: 'q-BK1134-0', name: 'AI算力', value: '', change: 1.5 }],
        marketStatus: '大A盘中',
        marketStatusShort: '盘中',
        marketTone: 'active',
        minuteCorner: true,
      },
      {
        key: 'us',
        label: '美股',
        metrics: [
          { id: 'q-BK1134-0', name: 'AI算力', value: '', change: 2.3, minuteCode: 'us-BK1134' },
        ],
        marketStatus: '美股盘后',
        marketStatusShort: '盘后',
        marketTone: 'quiet',
        minuteCorner: false,
      },
    ],
  }
}

const storeOf = () => {
  const store = new MarketStore()
  return {
    store,
    resolve: (sectionId: string, sessionDefault: string) =>
      store.resolveSectionTab(sectionId, sessionDefault),
  }
}

test('projectSectionTab：未手动选择时按数据层的时段默认 Tab 投影（进入页面默认选中）', () => {
  const { resolve } = storeOf()
  const view = projectSectionTab(industryBoardSection(), resolve)

  assert.equal(view.activeTab, 'a', 'A股时段默认选中 A股 Tab')
  assert.equal(view.metrics[0]?.change, 1.5, '分区指标为 A股 Tab 数据')
  assert.equal(view.marketStatus, '大A盘中', '阶段胶囊随选中 Tab')
  assert.equal(view.marketTone, 'active')
  assert.equal(view.minuteCorner, true, 'A股 Tab 有板块分时 → 展示「分时」角标')
  // 渲染层拿到的 Tab 条：标签 + **各自的**盘面状态（两个市场此刻状态一眼可比），
  // 不含任何 Tab 的指标数据（避免重复 setData）
  assert.deepEqual(view.tabs, [
    { key: 'a', label: 'A股', marketStatusShort: '盘中', marketTone: 'active' },
    { key: 'us', label: '美股', marketStatusShort: '盘后', marketTone: 'quiet' },
  ])
  assert.equal(
    view.tabs?.[0]?.metrics,
    undefined,
    '渲染层不下发各 Tab 的整份指标（避免重复 setData）',
  )
})

test('projectSectionTab：用户手动切到美股 Tab 立即生效（无需等下一次轮询）', () => {
  const { store, resolve } = storeOf()
  const section = industryBoardSection()
  // 手动选择：点 Tab 时记录「选了什么 + 当时的时段默认值」
  store.pickSectionTab('industry-board', 'us', section.activeTab ?? '')

  const view = projectSectionTab(section, resolve)
  assert.equal(view.activeTab, 'us')
  assert.equal(view.metrics[0]?.change, 2.3, '分区指标切换为美股 Tab 数据')
  assert.equal(view.metrics[0]?.minuteCode, 'us-BK1134', '分时代码随 Tab 口径（代理股合成）')
  assert.equal(view.marketStatus, '美股盘后', '阶段胶囊随选中 Tab 切为美股阶段')
  assert.equal(view.marketTone, 'quiet')
  assert.equal(view.minuteCorner, false, '美股盘后无分时图 → 不展示「分时」角标')
})

test('projectSectionTab：时段口径翻转后手动选择失效，回到新的时段默认', () => {
  const { store, resolve } = storeOf()
  const section = industryBoardSection() // 数据层默认 'a'（A股时段）
  const usSession: MarketSection = { ...section, activeTab: 'us' } // 数据层默认 'us'（美股时段）

  // 用户在 A股时段（默认 'a'）手动切到美股 → 立即生效
  store.pickSectionTab('industry-board', 'us', 'a')
  assert.equal(projectSectionTab(section, resolve).activeTab, 'us')

  // 时段翻转到美股时段（默认变 'us'）：手动选择是在默认 'a' 时做的 → 失效，随新默认展示
  assert.equal(projectSectionTab(usSession, resolve).activeTab, 'us', '手动选择不跨时段口径沿用')

  // 手动选择在**同一时段口径内**持续有效：美股时段选 A股 → 保持 A股
  store.pickSectionTab('industry-board', 'a', 'us')
  assert.equal(projectSectionTab(usSession, resolve).activeTab, 'a')

  // 反向：美股时段选了「美股」（与当时默认一致）也不会钉住面板——回到 A股时段仍按 A股默认展示
  store.pickSectionTab('industry-board', 'us', 'us')
  assert.equal(projectSectionTab(usSession, resolve).activeTab, 'us')
  assert.equal(projectSectionTab(section, resolve).activeTab, 'a', '回到 A股时段按 A股默认展示')
})

test('projectSectionTab：无 Tab 的面板原样返回（不影响指数 / 宏观经济等分区）', () => {
  const { resolve } = storeOf()
  const plain: MarketSection = {
    id: 'cn-index',
    title: 'A股指数',
    tone: 'global',
    metrics: [{ id: 'q-sh000001-0', name: '上证指数', value: '3421.50', change: 1.2 }],
    marketStatus: '盘中',
    marketTone: 'active',
  }
  assert.equal(projectSectionTab(plain, resolve), plain, '同一个对象引用返回，字段零改动')
})

test('resolveSectionTab：默认键缺失（面板无数据）时忽略手动选择，不返回过期 Tab 键', () => {
  const { store, resolve } = storeOf()
  store.pickSectionTab('industry-board', 'us', 'a')
  assert.equal(resolve('industry-board', ''), '', '无默认键时按传入值（空）展示，不落到手动选择')
  assert.equal(resolve('industry-board', 'a'), 'us', '默认键一致时手动选择生效')
})
