import assert from 'node:assert/strict'
import test from 'node:test'

import {
  __resetTrackerForTest,
  flush,
  initTracker,
  onAppHide,
  onAppShow,
  setTrackingEnabled,
  setTrackingLoginWaiter,
  track,
  trackEvent,
} from '../utils/tracker.ts'
import { TrackEventType } from '../types/tracking.ts'
import type { AppRouteEvent } from '../types/tracking.ts'

// ---------------------------------------------------------------------------
// 测试环境：wx mock（request / storage / 设备信息 / onAppRoute）+ getCurrentPages
// ---------------------------------------------------------------------------

interface RequestOptions {
  url?: string
  method?: string
  data?: { events?: Array<Record<string, unknown>> }
  header?: Record<string, string>
  success?: (res: { data: unknown }) => void
  fail?: (err: { errMsg?: string }) => void
}

interface CapturedRequest {
  url: string
  method: string
  data: { events: Array<Record<string, unknown>> }
  header: Record<string, string>
}

interface WxMock {
  getAccountInfoSync: () => { miniProgram: { version: string; envVersion: string; appId: string } }
  getStorageSync: (key: string) => unknown
  getDeviceInfo: () => { platform: string }
  onAppRoute?: (listener: (res: AppRouteEvent) => void) => void
  request: (options: RequestOptions) => void
}

let captured: CapturedRequest[] = []
let failRequests = false
let storage: Record<string, unknown> = {}

/** 安装 wx mock；request 行为默认成功，failRequests=true 时走 fail 分支 */
function installWx(overrides: Partial<WxMock> = {}): void {
  const mock: WxMock = {
    getAccountInfoSync: () => ({
      miniProgram: { version: '1.0.0', envVersion: 'develop', appId: 'wx-test' },
    }),
    getStorageSync: (key: string) => storage[key] ?? '',
    getDeviceInfo: () => ({ platform: 'devtools' }),
    request: (options: RequestOptions) => {
      captured.push({
        url: options.url ?? '',
        method: options.method ?? 'GET',
        data: options.data as { events: Array<Record<string, unknown>> },
        header: options.header ?? {},
      })
      if (failRequests) {
        options.fail?.({ errMsg: 'request:fail' })
      } else {
        options.success?.({ data: { code: 200, data: { accepted: 1, duplicated: 0, invalid: 0 } } })
      }
    },
    ...overrides,
  }
  ;(globalThis as Record<string, unknown>).wx = mock
}

function setCurrentPages(pages: Array<{ route: string }>): void {
  ;(globalThis as Record<string, unknown>).getCurrentPages = () => pages
}

function reset(): void {
  __resetTrackerForTest()
  captured = []
  failRequests = false
  storage = {}
  delete (globalThis as Record<string, unknown>).getCurrentPages
}

// ---------------------------------------------------------------------------
// 用例
// ---------------------------------------------------------------------------

test('track：事件携带公共字段（eventName / eventType / sessionId / eventId / clientTs / platform / appVersion）', async () => {
  reset()
  installWx()
  track('search.submit', { eventType: TrackEventType.Action, props: { keyword: '茅台' } })
  await flush()
  const event = captured[0]!.data.events[0]!
  assert.equal(event.eventName, 'search.submit')
  assert.equal(event.eventType, 'action')
  assert.deepEqual(event.props, { keyword: '茅台' })
  assert.ok(event.sessionId, 'sessionId 非空')
  assert.match(String(event.eventId), new RegExp(`^${String(event.sessionId)}-\\d+$`))
  assert.equal(typeof event.clientTs, 'number')
  assert.equal(event.platform, 'devtools')
  assert.match(String(event.appVersion), /^\d+\.\d+\.\d+$/)
})

test('eventId：会话内唯一且递增', async () => {
  reset()
  installWx()
  track('test.a', { page: 'pages/x/index' })
  track('test.b', { page: 'pages/x/index' })
  track('test.c', { page: 'pages/x/index' })
  await flush()
  const ids = captured[0]!.data.events.map((event) => String(event.eventId))
  assert.equal(new Set(ids).size, 3, 'eventId 互不相同')
  assert.equal(ids[0]!.split('-').pop(), '1')
  assert.equal(ids[2]!.split('-').pop(), '3')
})

test('攒批：队列达到 batchSize 自动上报一次', () => {
  reset()
  installWx()
  for (let i = 0; i < 50; i++) track('test.batch', { page: 'pages/x/index' })
  // 第 50 条触发 flush，wx.request 同步被调用（无需 await）
  assert.equal(captured.length, 1)
  assert.equal(captured[0]!.data.events.length, 50)
})

test('flush：POST 到打点接口，请求体为批量 events', async () => {
  reset()
  installWx()
  track('test.payload', { page: 'pages/x/index', eventType: TrackEventType.Action })
  await flush()
  assert.equal(captured.length, 1)
  assert.equal(captured[0]!.url, 'https://dev-wx-stock-interface.guyu.org.cn/api/v1/track/events')
  assert.equal(captured[0]!.method, 'POST')
  assert.ok(Array.isArray(captured[0]!.data.events))
  assert.equal(captured[0]!.data.events.length, 1)
})

test('上报失败：事件放回队首重试（eventId 幂等，不重复计数）', async () => {
  reset()
  installWx()
  failRequests = true
  track('test.retry', { page: 'pages/x/index' })
  await flush()
  assert.equal(captured.length, 1)
  const firstIds = captured[0]!.data.events.map((event) => event.eventId)
  failRequests = false
  await flush()
  assert.equal(captured.length, 2)
  const secondIds = captured[1]!.data.events.map((event) => event.eventId)
  assert.deepEqual(secondIds, firstIds, '重试批次 eventId 与首次一致')
})

test('失败堆积超过队列上限：丢弃最旧事件', async () => {
  reset()
  installWx()
  failRequests = true
  for (let i = 0; i < 250; i++) track('test.cap', { page: 'pages/x/index' })
  // 让失败重试的微任务（放回 + 截断到 maxQueue=200）执行完
  await new Promise((resolve) => setTimeout(resolve, 0))
  failRequests = false
  await flush()
  const last = captured[captured.length - 1]!
  assert.equal(last.data.events.length, 200)
})

test('props 清洗：剔除 undefined / 函数，超长字符串截断到 256', async () => {
  reset()
  installWx()
  track('test.props', {
    page: 'pages/x/index',
    eventType: TrackEventType.Action,
    props: {
      keep: 'ok',
      drop: undefined,
      long: 'x'.repeat(300),
      num: 42,
      nested: { a: 'y'.repeat(300), b: undefined },
    },
  })
  await flush()
  const props = captured[0]!.data.events[0]!.props as Record<string, unknown>
  assert.equal(props.keep, 'ok')
  assert.equal('drop' in props, false)
  assert.equal((props.long as string).length, 256)
  assert.equal(props.num, 42)
  assert.equal((props.nested as Record<string, unknown>).a, 'y'.repeat(256))
  assert.equal('b' in (props.nested as Record<string, unknown>), false)
})

test('trackEvent：search.submit 关键词截断到 32，空白不埋', async () => {
  reset()
  installWx()
  trackEvent('search.submit', `   ${'长'.repeat(50)}  `)
  trackEvent('search.submit', '   ')
  await flush()
  const events = captured[0]!.data.events
  assert.equal(events.length, 1)
  assert.equal((events[0]!.props as Record<string, unknown>).keyword, '长'.repeat(32))
})

test('wx.onAppRoute：路由切换自动 page.view / page.hide，详情页 target 取 query.code', async () => {
  reset()
  let listener: (res: AppRouteEvent) => void = () => {}
  installWx({ onAppRoute: (l) => (listener = l) })
  initTracker()

  listener({ path: 'pages/stock-detail/index', query: { code: '600519' } })
  listener({ path: 'pages/minute/index', query: { code: 'GOLD' } })
  await flush()
  const events = captured[0]!.data.events
  assert.equal(events.length, 3)
  // 第一跳 page.view（个股详情 target=code）
  assert.equal(events[0]!.eventName, 'page.view')
  assert.equal(events[0]!.page, 'pages/stock-detail/index')
  assert.equal(events[0]!.target, '600519')
  assert.equal(events[0]!.eventType, 'page_view')
  // 第二跳：先补上一页 page.hide（durationMs），再 page.view（分时 target=code）
  assert.equal(events[1]!.eventName, 'page.hide')
  assert.equal(events[1]!.page, 'pages/stock-detail/index')
  assert.ok((events[1]!.durationMs as number) >= 0)
  assert.equal(events[2]!.eventName, 'page.view')
  assert.equal(events[2]!.page, 'pages/minute/index')
  assert.equal(events[2]!.target, 'GOLD')
})

test('wx.onAppRoute：同一路径重复触发不重复埋点', async () => {
  reset()
  let listener: (res: AppRouteEvent) => void = () => {}
  installWx({ onAppRoute: (l) => (listener = l) })
  initTracker()
  listener({ path: 'pages/global/index' })
  await flush()
  assert.equal(captured.length, 1)
  listener({ path: 'pages/global/index' })
  await flush()
  assert.equal(captured.length, 1, '同一页面路径不重复 view/hide')
})

test('onAppShow：冷启动兜底补发首个 page.view', async () => {
  reset()
  installWx()
  setCurrentPages([{ route: 'pages/global/index' }])
  onAppShow()
  await flush()
  const events = captured[0]!.data.events
  assert.equal(events.length, 1)
  assert.equal(events[0]!.eventName, 'page.view')
  assert.equal(events[0]!.page, 'pages/global/index')
})

test('onAppHide：结算当前页停留（page.hide + durationMs）并上报', async () => {
  reset()
  let listener: (res: AppRouteEvent) => void = () => {}
  installWx({ onAppRoute: (l) => (listener = l) })
  initTracker()
  listener({ path: 'pages/news/index' })
  onAppHide()
  await flush()
  const events = captured[0]!.data.events
  assert.equal(events.length, 2)
  assert.equal(events[0]!.eventName, 'page.view')
  assert.equal(events[1]!.eventName, 'page.hide')
  assert.equal(events[1]!.page, 'pages/news/index')
  assert.ok((events[1]!.durationMs as number) >= 0)
})

test('trackEvent：标量参数按定义表映射 target / props（tab / search / result_tap / theme / share）', async () => {
  reset()
  installWx()
  setCurrentPages([{ route: 'pages/search/index' }])
  trackEvent('tab.switch', 'finance')
  trackEvent('search.submit', '茅台')
  trackEvent('search.result_tap', '600519')
  trackEvent('theme.switch', 'dark')
  trackEvent('share.trigger')
  await flush()
  const events = captured[0]!.data.events
  assert.equal(events.length, 5)
  assert.deepEqual(events[0]!.props, undefined)
  assert.equal(events[0]!.target, 'finance')
  assert.equal(events[0]!.eventName, 'tab.switch')
  assert.equal(events[1]!.eventName, 'search.submit')
  assert.deepEqual(events[1]!.props, { keyword: '茅台' })
  assert.equal(events[2]!.eventName, 'search.result_tap')
  assert.equal(events[2]!.target, '600519')
  assert.equal(events[3]!.eventName, 'theme.switch')
  assert.deepEqual(events[3]!.props, { theme: 'dark' })
  assert.equal(events[4]!.eventName, 'share.trigger')
  assert.deepEqual(events[4]!.props, { source: 'pages/search/index' })
})

test('trackEvent：未登记的事件不产生数据（warn 防御）', async () => {
  reset()
  installWx()
  trackEvent('not.registered', 'x')
  await flush()
  assert.equal(captured.length, 0)
})

test('有 token 时上报带 Bearer（withAuth，后端据此解析 user_id）', async () => {
  reset()
  storage['market_tracker_token'] = 'tok-123'
  installWx()
  track('test.auth', { page: 'pages/x/index' })
  await flush()
  assert.equal(captured[0]!.header.Authorization, 'Bearer tok-123')
})

test('登录门闩：登录未成功（false）不上报，事件留在队列', async () => {
  reset()
  installWx()
  setTrackingLoginWaiter(() => Promise.resolve(false))
  track('test.gate', { page: 'pages/x/index' })
  await flush()
  assert.equal(captured.length, 0, '登录失败不上报')
  // 再次 flush 仍被门闩拦截
  await flush()
  assert.equal(captured.length, 0)
})

test('登录门闩：登录成功后自动补报排队事件（带 Bearer）', async () => {
  reset()
  storage['market_tracker_token'] = 'tok-123'
  installWx()
  let loggedIn = false
  setTrackingLoginWaiter(() => Promise.resolve(loggedIn))
  track('test.gate', { page: 'pages/x/index' })
  await flush()
  assert.equal(captured.length, 0, '登录前不上报')
  // 登录成功
  loggedIn = true
  await flush()
  assert.equal(captured.length, 1, '登录成功后补报')
  assert.equal(captured[0]!.data.events.length, 1)
  assert.equal(captured[0]!.data.events[0]!.eventName, 'test.gate')
  assert.equal(captured[0]!.header.Authorization, 'Bearer tok-123')
})

test('setTrackingEnabled(false)：track 丢弃、flush 不发请求', async () => {
  reset()
  installWx()
  setTrackingEnabled(false)
  track('test.off', { page: 'pages/x/index' })
  await flush()
  assert.equal(captured.length, 0)
  setTrackingEnabled(true)
})

test('trackEvent：news.view 查看新闻详情，props 带 id + 标题（标题去空格兜底）', async () => {
  reset()
  installWx()
  trackEvent('news.view', { id: 77415, title: '  美联储纪要：降息预期升温  ' })
  trackEvent('news.view', { title: '' })
  await flush()
  const events = captured[0]!.data.events
  assert.equal(events.length, 2)
  assert.equal(events[0]!.eventName, 'news.detail.view')
  assert.equal(events[0]!.eventType, 'page_view')
  assert.equal(events[0]!.page, 'pages/news-detail/index')
  assert.deepEqual(events[0]!.props, { id: '77415', title: '美联储纪要：降息预期升温' })
  // 空标题兜底文案，id 缺失时 props 不带 id
  assert.deepEqual(events[1]!.props, { title: '未知新闻' })
})

test('trackEvent：card.tap 点行情卡片，target=code，props 带名称与取数代码', async () => {
  reset()
  installWx()
  trackEvent('card.tap', { code: 'GOLD', name: 'COMEX黄金(纽约金)', minuteCode: 'GOLD-US' })
  await flush()
  const event = captured[0]!.data.events[0]!
  assert.equal(event.eventName, 'market.card_tap')
  assert.equal(event.eventType, 'tap')
  assert.equal(event.target, 'GOLD')
  assert.deepEqual(event.props, {
    code: 'GOLD',
    name: 'COMEX黄金(纽约金)',
    minuteCode: 'GOLD-US',
  })
})

test('trackEvent：tip.open 点「i」图标打开说明弹窗，标量作 section（空白不埋）', async () => {
  reset()
  installWx()
  trackEvent('tip.open', '  金银  ')
  trackEvent('tip.open', '   ')
  await flush()
  const events = captured[0]!.data.events
  assert.equal(events.length, 1)
  assert.equal(events[0]!.eventName, 'info.tip_open')
  assert.equal(events[0]!.eventType, 'tap')
  assert.deepEqual(events[0]!.props, { section: '金银' })
})
