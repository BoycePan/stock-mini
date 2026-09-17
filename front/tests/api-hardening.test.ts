/**
 * 本轮「接口层加固」回归测试（api / stores / config 范围）。
 *
 * 覆盖：
 * - C：api/news.ts getFeedPage 对「200 空 body（request resolve undefined）」的兜底取值；
 * - B：api/quote.ts fetchClistAll 分页硬上限（上游 total 异常大时不 fan-out）；
 * - D：api/stock.ts getQuotes 空数组短路（不再发出不带 codes 的请求）；
 * - E：api/gold-shop.ts 涨跌额 / 涨跌幅非有限数归一为 0（让 hideFlatChange 能判定「无涨跌」）；
 * - G：stores 退出登录使全局就绪失效（rootStore.invalidateBootstrap 由 auth.logout 触发）；
 * - H：stores/system.store.ts fetchAll 两路各自降级（Promise.allSettled）；
 * - I：config/minute.ts 分时源查表用自有属性判定（挡住 __proto__ / constructor 探针）；
 * - J：config/tabbar.ts 外盘铜 emSecid 与分时同源、usRange 按东财刻度。
 */
import assert from 'node:assert/strict'
import test from 'node:test'

import { parseGoldShopBody } from '../api/gold-shop'
import { newsApi } from '../api/news'
import { quoteApi } from '../api/quote'
import { stockApi } from '../api/stock'
import { systemApi } from '../api/system'
import { MINUTE_SOURCES, hasMinuteSources, resolveMinuteSources } from '../config/minute'
import { METALS } from '../config/tabbar'
import { SystemStore } from '../stores/system.store'
import { rootStore } from '../stores/root.store'
import type { AppConfig, Notice } from '../types/system'

// ---------------------------------------------------------------------------
// wx mock：storage / 账号信息（请求层 getEnv 需要）+ wx.request 捕获
// ---------------------------------------------------------------------------

interface RequestOptions {
  url?: string
  method?: string
  success?: (res: { data: unknown; statusCode?: number }) => void
  fail?: (err: { errMsg?: string }) => void
}

interface CapturedRequest {
  url: string
  method: string
}

let captured: CapturedRequest[] = []
/** 下一次（及之后）wx.request 的响应体；默认 200 空 body（等价后端返回 {"code":200} 无 data） */
let nextBody: unknown = { code: 200 }

function installWx(): void {
  ;(globalThis as Record<string, unknown>).wx = {
    getStorageSync: () => '',
    setStorageSync: () => {},
    removeStorageSync: () => {},
    getAccountInfoSync: () => ({
      miniProgram: { version: '1.0.0', envVersion: 'develop', appId: 'wx-test' },
    }),
    getDeviceInfo: () => ({ platform: 'devtools' }),
    request: (options: RequestOptions) => {
      captured.push({ url: options.url ?? '', method: options.method ?? 'GET' })
      // statusCode 供 api/external.ts 判定（外部接口要求 2xx），request() 只读 data
      options.success?.({ data: nextBody, statusCode: 200 })
    },
  }
}

function reset(body: unknown = { code: 200 }): void {
  captured = []
  nextBody = body
  installWx()
}

// ---------------------------------------------------------------------------
// C：news feed 响应结构兜底
// ---------------------------------------------------------------------------

test('C：getFeedPage 遇到 200 空 body（data 缺失）返回空列表而非抛 TypeError', async () => {
  reset({ code: 200 })
  const page = await newsApi.getFeedPage(1, 20)
  assert.deepEqual(page.items, [])
  assert.equal(page.hasMore, false, '空列表不应声称还有下一页')
})

test('C：getFeedPage 有 news 字段时取后端真实 hasMore', async () => {
  reset({
    code: 200,
    data: { count: 1, hasMore: true, news: [{ id: '1', title: '标题', url: 'https://x' }] },
  })
  const page = await newsApi.getFeedPage(1, 20)
  assert.equal(page.items.length, 1)
  // hasMore 显式给出时以它为准：不能因为「本页没拉满 20 条」就判定没有下一页
  assert.equal(page.hasMore, true)
})

test('C：getFeedPage 兼容数组响应，并按页大小推断 hasMore', async () => {
  reset({ code: 200, data: [{ id: '1', title: '标题', url: 'https://x' }] })
  const page = await newsApi.getFeedPage(1, 1)
  assert.equal(page.items.length, 1)
  assert.equal(page.hasMore, true, '拉满一页时按页大小推断还有下一页')
})

test('C：getFeedPage 字段改名（news 非数组）时不抛错、按空列表处理', async () => {
  reset({ code: 200, data: { count: 0, list: [] } })
  const page = await newsApi.getFeedPage(1, 20)
  assert.deepEqual(page.items, [])
  assert.equal(page.hasMore, false)
})

// ---------------------------------------------------------------------------
// B：clist 分页硬上限（上游 total 异常大）
// ---------------------------------------------------------------------------

test('B：上游 total 异常大时 clist 分页被硬上限截断，不再 fan-out 上百个请求', async () => {
  // 上游 total=50 万（被污染 / 口径变化）：旧实现会按 ceil(500000/1000)=500 页一次性并行，
  // 触发上百个 wx.request（微信并发上限 10，其余排队并各自吃满 15s 超时）。
  reset({ data: { total: 500000, diff: [{ f2: 10, f18: 9 }] } })
  const page = await quoteApi.eastmoneyAShareSnapshot()
  // 上界 = 1（首屏大页）+ 10（截断后分页），每个 host 各一轮；覆盖不足会再回退另一个 host
  assert.ok(captured.length <= 22, `请求数应受硬上限约束，实际 ${captured.length}`)
  assert.ok(captured.length > 0)
  assert.equal(page.total, 500000, 'total 原样返回，让覆盖度校验如实判定「覆盖不足」')
})

// ---------------------------------------------------------------------------
// D：getQuotes 空数组短路
// ---------------------------------------------------------------------------

test('D：getQuotes 空数组直接返回 []，不发不带 codes 的请求', async () => {
  reset()
  const quotes = await stockApi.getQuotes([])
  assert.deepEqual(quotes, [])
  assert.equal(captured.length, 0, '空标的列表不应发出任何请求')
})

test('D：getQuotes 正常入参仍带 codes 查询参数', async () => {
  reset({ code: 200, data: [] })
  await stockApi.getQuotes(['600519', '000001'])
  assert.equal(captured.length, 1)
  assert.match(captured[0]!.url, /\/api\/v1\/stock\/quotes\?codes=600519%2C000001$/)
})

// ---------------------------------------------------------------------------
// E：金店金价涨跌字段有限性归一
// ---------------------------------------------------------------------------

test('E：parseGoldShopBody 把非数字的 q70/q80 归一为 0（而非 NaN）', () => {
  const body =
    'var quote_json = {"flag":true,' +
    '"JO_1":{"q63":1318.0,"q70":"-","q80":"--","unit":"元/克","showName":"黄金价格"},' +
    '"JO_2":{"q63":758.0,"q70":null,"q80":"abc","unit":"元/克","showName":"基础金价"},' +
    '"errorCode":[]};'
  const quotes = parseGoldShopBody(body)
  assert.equal(quotes.length, 2)
  for (const quote of quotes) {
    // NaN 既不 === null 也不 === 0，会绕过 utils/quote-pages.ts hideFlatChange 的隐藏判定，
    // 在金店金价 / 实物黄金分组渲染无意义涨跌徽标 —— 因此必须是 0
    assert.equal(Number.isFinite(quote.pct), true, `pct 应为有限数: ${quote.code}`)
    assert.equal(Number.isFinite(quote.change), true, `change 应为有限数: ${quote.code}`)
    assert.equal(quote.pct, 0)
    assert.equal(quote.change, 0)
  }
})

// ---------------------------------------------------------------------------
// I：分时源查表不得命中 Object.prototype
// ---------------------------------------------------------------------------

test('I：hasMinuteSources 对原型链属性返回 false（分享链接可构造 code）', () => {
  for (const code of ['__proto__', 'constructor', 'toString', 'hasOwnProperty', 'valueOf']) {
    assert.equal(hasMinuteSources(code), false, `${code} 不应被判为支持分时图`)
    assert.equal(resolveMinuteSources(code), null, `${code} 不应解析出分时源`)
  }
})

test('I：正常分时源与个股兜底规则不受加固影响', () => {
  assert.equal(hasMinuteSources('COPPER-US'), true)
  assert.deepEqual(resolveMinuteSources('sh600519'), { em: '1.600519', tc: 'sh600519' })
  // 美股 secid 兜底：东财 secid + 腾讯代码（usNVDA，腾讯美股份时/快照不带 .OQ/.N 后缀）
  assert.deepEqual(resolveMinuteSources('105.NVDA'), { em: '105.NVDA', tc: 'usNVDA' })
  assert.equal(hasMinuteSources(''), false)
})

// ---------------------------------------------------------------------------
// J：外盘铜卡片与分时同源
// ---------------------------------------------------------------------------

test('J：外盘铜卡片 emSecid 与分时 COPPER-US 同源，usRange 按东财刻度', () => {
  const copper = METALS.find((metal) => metal.code === 'COPPER')
  assert.ok(copper, '缺少 COPPER 金属配置')
  assert.equal(copper.emSecid, '101.HG00Y', '外盘铜卡片应优先东财 COMEX 铜（与分时同 secid）')
  const minute = MINUTE_SOURCES['COPPER-US']
  assert.ok(minute?.em, '缺少 COPPER-US 分时源')
  assert.equal(copper.emSecid, minute.em, '卡片 emSecid 必须与分时源一致（「卡片=分时」不变量）')
  // 东财 ulist（fltt=2）的 101.HG00Y 是美元/磅（实测 6.534），新浪 hf_HG 是美分/磅（659.17）：
  // usRange 必须容纳东财刻度，否则 resolveMetal 的区间校验会拒掉东财报价，卡片退回新浪刻度
  const [min, max] = copper.usRange ?? [0, 0]
  assert.ok(min < 6.534 && max > 6.534, `usRange 应容纳东财报价刻度: ${min}~${max}`)
})

// ---------------------------------------------------------------------------
// G：退出登录使全局就绪失效
// ---------------------------------------------------------------------------

test('G：logout 后 bootstrap 重新走登录（不再复用旧的已就绪 Promise）', async () => {
  reset()
  rootStore.system.ready = true
  let loginCalls = 0
  rootStore.auth.ensureLogin = async () => {
    loginCalls += 1
    return null
  }
  rootStore.system.fetchAll = async () => {}
  try {
    await rootStore.bootstrap()
    assert.equal(loginCalls, 1)
    // 同一会话内重复 bootstrap 必须复用同一个 Promise（否则每次请求都重新登录）
    await rootStore.bootstrap()
    assert.equal(loginCalls, 1, '未登出时不应重复登录')

    rootStore.auth.logout()
    assert.equal(rootStore.system.ready, false, '登出后配置就绪标记应复位')
    await rootStore.bootstrap()
    assert.equal(loginCalls, 2, '登出后下一次业务请求必须重新登录')
  } finally {
    delete (rootStore.auth as { ensureLogin?: unknown }).ensureLogin
    delete (rootStore.system as { fetchAll?: unknown }).fetchAll
    rootStore.system.ready = false
  }
})

// ---------------------------------------------------------------------------
// H：系统配置 / 公告两路各自降级
// ---------------------------------------------------------------------------

const notice = (id: number): Notice => ({
  id,
  type: 'notice',
  title: `公告${id}`,
  sort: id,
  pinned: false,
  config: {} as Notice['config'],
})

test('H：公告失败不影响 display 配置写回与 ready', async () => {
  const store = new SystemStore()
  const originalConfigs = systemApi.configs
  const originalNotices = systemApi.notices
  const config: AppConfig = { config: { homeShowTop100: true } }
  systemApi.configs = async () => config
  systemApi.notices = async () => {
    throw new Error('公告接口挂了')
  }
  try {
    await store.fetchAll()
  } finally {
    systemApi.configs = originalConfigs
    systemApi.notices = originalNotices
  }
  // 配置成功即可用：公告只是可选展示数据，拉不到不该拖垮整页就绪流程
  assert.deepEqual(store.configs, config)
  assert.equal(store.ready, true)
  assert.deepEqual(store.notices, [], '失败的一路保留旧值（空）')
  assert.match(store.error, /公告拉取失败/)
})

test('H：display 配置失败时 ready 保持 false、公告仍写回', async () => {
  const store = new SystemStore()
  const originalConfigs = systemApi.configs
  const originalNotices = systemApi.notices
  systemApi.configs = async () => {
    throw new Error('配置接口挂了')
  }
  systemApi.notices = async () => [notice(1)]
  try {
    await store.fetchAll()
  } finally {
    systemApi.configs = originalConfigs
    systemApi.notices = originalNotices
  }
  assert.equal(store.ready, false, '配置是就绪判定的必需数据')
  assert.equal(store.notices.length, 1)
  assert.equal(store.loading, false)
  assert.match(store.error, /展示配置拉取失败/)
})
