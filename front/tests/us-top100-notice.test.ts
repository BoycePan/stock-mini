import assert from 'node:assert/strict'
import test from 'node:test'

import type { Notice, PopupNotice } from '../types/system.ts'
import {
  dayDiff,
  resolveHomePopupNotice,
  shouldShowPopupNotice,
  todayDateString,
  tryShowPopupNotice,
  type PopupNoticeStorage,
} from '../utils/popup-notice.ts'
import { compareVersion, isVersionGte } from '../utils/version.ts'
import { clearAccountInfoCache } from '../utils/account-info.ts'

// ---------------------------------------------------------------------------
// compareVersion / isVersionGte：点分版本号比较
// ---------------------------------------------------------------------------

test('compareVersion：数字分段比较', () => {
  assert.equal(compareVersion('1.8.6', '1.8.5'), 1)
  assert.equal(compareVersion('1.8.5', '1.8.6'), -1)
  assert.equal(compareVersion('1.8.6', '1.8.6'), 0)
  assert.equal(compareVersion('1.10.0', '1.9.9'), 1) // 数字比较，非字符串比较
  assert.equal(compareVersion('1.8.6', '1.18.6'), -1)
})

test('compareVersion：缺段补 0 / 非法段按 0', () => {
  assert.equal(compareVersion('1.8', '1.8.0'), 0)
  assert.equal(compareVersion('2', '2.0.0'), 0)
  assert.equal(compareVersion('1.8.a', '1.8.0'), 0)
})

test('isVersionGte：版本门槛校验', () => {
  assert.equal(isVersionGte('1.8.6', '1.8.6'), true)
  assert.equal(isVersionGte('1.8.7', '1.8.6'), true)
  assert.equal(isVersionGte('1.8.5', '1.8.6'), false)
  assert.equal(isVersionGte('1.0.2', '1.8.6'), false) // 当前仓库兜底版本低于门槛
})

// ---------------------------------------------------------------------------
// resolveHomePopupNotice：服务端 notices（position='home'）→ 弹窗配置
// ---------------------------------------------------------------------------

/** 构造一条公告（形如 /api/v1/notices 返回的 position='home' 公告） */
function homeNotice(overrides: Partial<Notice> = {}, config: Record<string, unknown> = {}): Notice {
  return {
    id: 6,
    type: 'notice',
    title: '全新系统升级',
    position: 'home',
    sort: 0,
    pinned: false,
    config: {
      title: '美股市值TOP100 全新上线',
      content: '<p>公告正文</p>',
      path: '/packageQuote/pages/us-top100/index',
      buttonText: '立即查看',
      minVersion: '1.1.1',
      count: 2,
      envWhitelist: ['trial', 'release'],
      ...config,
    },
    ...overrides,
  }
}

/** 注入 wx 运行环境（envVersion：develop / trial / release；undefined = 清除，回退空串） */
function setWxEnv(envVersion: string | undefined): void {
  // getAccountInfo 是惰性缓存：换 wx mock 前必须清缓存
  clearAccountInfoCache()
  ;(globalThis as Record<string, unknown>).wx = envVersion
    ? { getAccountInfoSync: () => ({ miniProgram: { envVersion } }) }
    : undefined
}

test('resolveHomePopupNotice：home 公告映射为 PopupNotice + 按 id 缓存键', () => {
  setWxEnv('release') // fixture 带 envWhitelist，需命中当前环境
  const res = resolveHomePopupNotice([homeNotice()])
  assert.deepEqual(res, {
    popup: {
      title: '美股市值TOP100 全新上线',
      content: '<p>公告正文</p>',
      path: '/packageQuote/pages/us-top100/index',
      buttonText: '立即查看',
      minVersion: '1.1.1',
      count: 2,
      envWhitelist: ['trial', 'release'],
    },
    storageKey: 'popup_notice_state_6',
  })
  setWxEnv(undefined)
})

test('resolveHomePopupNotice：envWhitelist 命中当前环境（trial / release）→ 正常返回', () => {
  for (const env of ['trial', 'release']) {
    setWxEnv(env)
    const res = resolveHomePopupNotice([homeNotice()])
    assert.deepEqual(res?.popup.envWhitelist, ['trial', 'release'])
    assert.equal(res?.storageKey, 'popup_notice_state_6')
  }
  setWxEnv(undefined)
})

test('resolveHomePopupNotice：envWhitelist 不命中当前环境 → 跳过该公告（全被拦截返回 null）', () => {
  setWxEnv('develop') // 开发版不在 ['trial', 'release'] 白名单内
  assert.equal(resolveHomePopupNotice([homeNotice()]), null)
  setWxEnv(undefined)
})

test('resolveHomePopupNotice：envWhitelist 拦截第一条时继续取下一条放行的公告', () => {
  setWxEnv('develop')
  const gated = homeNotice({ id: 1 }) // ['trial','release']，不命中 develop
  const allowed = homeNotice({ id: 2 }, { envWhitelist: ['develop'] })
  const res = resolveHomePopupNotice([gated, allowed])
  assert.equal(res?.popup.content, '<p>公告正文</p>')
  assert.equal(res?.storageKey, 'popup_notice_state_2')
  setWxEnv(undefined)
})

test('resolveHomePopupNotice：envWhitelist 为空数组 / 非数组 → 不限（照常返回）', () => {
  setWxEnv('develop')
  // 空数组：不限，原样透传为 []
  const empty = resolveHomePopupNotice([homeNotice({}, { envWhitelist: [] })])
  assert.deepEqual(empty?.popup.envWhitelist, [])
  // 非数组非法值：按缺省处理（不限，映射为 undefined）
  for (const bad of ['garbage', 0, null]) {
    const res = resolveHomePopupNotice([homeNotice({}, { envWhitelist: bad })])
    assert.equal(res?.popup.envWhitelist, undefined)
  }
  setWxEnv(undefined)
})

test('resolveHomePopupNotice：无 home 公告 / content 缺失 → null（不弹）', () => {
  assert.equal(resolveHomePopupNotice([]), null)
  assert.equal(resolveHomePopupNotice([homeNotice({ position: 'settings' })]), null)
  assert.equal(resolveHomePopupNotice([homeNotice({}, { content: '' })]), null)
  assert.equal(resolveHomePopupNotice([homeNotice({}, { content: 123 })]), null)
})

test('resolveHomePopupNotice：取第一条合法的 home 公告（保持列表顺序）', () => {
  setWxEnv('release') // fixture 带 envWhitelist，需命中当前环境
  const first = homeNotice({ id: 1 }, { content: '第一条' })
  const second = homeNotice({ id: 2 }, { content: '第二条' })
  const res = resolveHomePopupNotice([second, first])
  assert.equal(res?.popup.content, '第二条')
  assert.equal(res?.storageKey, 'popup_notice_state_2')
  setWxEnv(undefined)
})

test('resolveHomePopupNotice：可选字段缺失走兜底（版本 / 天数 / 标题 / 按钮 / 路径）', () => {
  setWxEnv('release')
  const res = resolveHomePopupNotice([
    homeNotice(
      {},
      {
        title: undefined,
        path: undefined,
        buttonText: undefined,
        minVersion: undefined,
        count: undefined,
        envWhitelist: undefined,
      },
    ),
  ])
  assert.deepEqual(res?.popup, {
    title: undefined,
    content: '<p>公告正文</p>',
    path: '',
    buttonText: undefined,
    minVersion: '0.0.0',
    count: 1,
    envWhitelist: undefined,
  })
  assert.equal(res?.storageKey, 'popup_notice_state_6')
  setWxEnv(undefined)
})

// ---------------------------------------------------------------------------
// todayDateString / dayDiff：日期工具
// ---------------------------------------------------------------------------

test('todayDateString：补零到 YYYY-MM-DD', () => {
  assert.equal(todayDateString(new Date(2026, 7, 30)), '2026-08-30')
  assert.equal(todayDateString(new Date(2026, 0, 5)), '2026-01-05')
  assert.equal(todayDateString(new Date(2026, 11, 31)), '2026-12-31')
})

test('dayDiff：跨月 / 同年天数差', () => {
  assert.equal(dayDiff('2026-08-30', '2026-08-30'), 0)
  assert.equal(dayDiff('2026-08-30', '2026-09-01'), 2)
  assert.equal(dayDiff('2026-12-30', '2027-01-02'), 3)
})

test('dayDiff：Date.parse 失败返回 NaN（count 天判定对 NaN 恒为 false 的成因）', () => {
  assert.ok(Number.isNaN(dayDiff('garbage', '2026-08-30')))
  assert.ok(Number.isNaN(dayDiff('2026-08-30', 'garbage')))
  assert.ok(Number.isNaN(dayDiff('2026/08/30', '2026-08-30')), '非 YYYY-MM-DD 分隔符解析失败')
  assert.ok(Number.isNaN(dayDiff('2026-13-01', '2026-08-30')), '月份溢出解析失败')
  // 注意（实测 V8 行为）：月内溢出日不会被 Date.parse 拒绝，而是被归一化——
  // Date.parse('2026-02-31T00:00:00') = 2026-03-03（不是 NaN），故 isValidState 不能只靠
  // Date.parse，必须回环比对年月日字段（见下方「日期不可解析」用例里的 2026-02-31）。
  assert.equal(Number.isNaN(dayDiff('2026-02-31', '2026-08-30')), false)
})

// ---------------------------------------------------------------------------
// shouldShowPopupNotice：一天一次 × count 天
// ---------------------------------------------------------------------------

// minVersion 取 '1.0.2'：测试环境 wx 不可用，getAppVersion() 回退 FALLBACK_VERSION '1.1.0'
// （utils/version.ts），保证 tryShowPopupNotice 能越过版本门槛、真正测到 storage 逻辑
const notice: PopupNotice = { content: 'x', path: '/p', minVersion: '1.0.2', count: 3 }

test('shouldShowPopupNotice：从未展示 → 展示并记录首日', () => {
  const res = shouldShowPopupNotice(notice, '2026-08-30', null)
  assert.equal(res.show, true)
  assert.deepEqual(res.state, { firstShownDate: '2026-08-30', lastShownDate: '2026-08-30' })
})

test('shouldShowPopupNotice：当天已展示过 → 不展示', () => {
  const state = { firstShownDate: '2026-08-30', lastShownDate: '2026-08-30' }
  const res = shouldShowPopupNotice(notice, '2026-08-30', state)
  assert.equal(res.show, false)
  assert.deepEqual(res.state, state) // 状态不变
})

test('shouldShowPopupNotice：count 天内次日 → 展示并更新 lastShownDate', () => {
  const state = { firstShownDate: '2026-08-30', lastShownDate: '2026-08-30' }
  const res = shouldShowPopupNotice(notice, '2026-08-31', state)
  assert.equal(res.show, true)
  assert.deepEqual(res.state, { firstShownDate: '2026-08-30', lastShownDate: '2026-08-31' })
})

test('shouldShowPopupNotice：满 count 天后 → 活动结束不再展示', () => {
  // count=3：展示第 0 / 1 / 2 天；第 3 天起结束
  const state = { firstShownDate: '2026-08-30', lastShownDate: '2026-09-01' }
  assert.equal(shouldShowPopupNotice(notice, '2026-09-01', state).show, false) // 当天已展示
  assert.equal(shouldShowPopupNotice(notice, '2026-09-02', state).show, false) // dayDiff=3 ≥ count
  assert.equal(shouldShowPopupNotice(notice, '2026-09-10', state).show, false) // 跨月后同样失效
})

test('shouldShowPopupNotice：count=3 连续三天各展示一次', () => {
  let state: unknown = null
  const shows: boolean[] = []
  for (let d = 30; d <= 33; d++) {
    const today = todayDateString(new Date(2026, 7, d)) // 2026-08-30 … 2026-09-02
    const res = shouldShowPopupNotice(notice, today, state)
    shows.push(res.show)
    state = res.state
  }
  assert.deepEqual(shows, [true, true, true, false])
})

test('shouldShowPopupNotice：非法 / 损坏的缓存状态按首次展示处理', () => {
  for (const bad of [{}, { firstShownDate: 123 }, { lastShownDate: 'x' }, 'garbage', 0]) {
    const res = shouldShowPopupNotice(notice, '2026-08-30', bad)
    assert.equal(res.show, true)
    assert.deepEqual(res.state, { firstShownDate: '2026-08-30', lastShownDate: '2026-08-30' })
  }
})

test('shouldShowPopupNotice：日期不可解析 / 不存在的状态按首次展示处理（避免 count 天规则失效、公告每天无限弹）', () => {
  // 两个字段都是字符串但日期不可用：dayDiff 返回 NaN，`NaN >= count` 恒为 false，
  // 只校验 typeof === 'string' 时 count 天到期规则会静默失效 → 公告每天无限弹。
  // 现在判为损坏状态 → 自愈为「首次展示」并重写为合法日期。
  for (const bad of [
    { firstShownDate: 'garbage', lastShownDate: '2026-08-29' },
    { firstShownDate: '2026-08-01', lastShownDate: 'garbage' },
    { firstShownDate: '2026-02-31', lastShownDate: '2026-08-29' }, // 格式合法但日期不存在（Date.parse 会归一化成 3/3）
    { firstShownDate: '2026-13-01', lastShownDate: '2026-08-29' }, // 月份溢出
    { firstShownDate: '2026-08-32', lastShownDate: '2026-08-29' }, // 日期溢出
    { firstShownDate: '2026/08/01', lastShownDate: '2026-08-29' }, // 分隔符不合法
    { firstShownDate: '2026-8-1', lastShownDate: '2026-08-29' }, // 未补零
  ]) {
    const res = shouldShowPopupNotice(notice, '2026-08-30', bad)
    assert.equal(res.show, true, `损坏状态应自愈为首次展示：${JSON.stringify(bad)}`)
    assert.deepEqual(res.state, { firstShownDate: '2026-08-30', lastShownDate: '2026-08-30' })
  }
  // 合法日期（含闰年 2/29）不受影响，仍按正常规则计天
  assert.equal(
    shouldShowPopupNotice(notice, '2026-08-30', {
      firstShownDate: '2024-02-29',
      lastShownDate: '2024-02-29',
    }).show,
    false,
    '合法但久远的首次展示日期仍应正常判为「活动已结束」',
  )
  // 自愈后按正常规则续算：次日仍在 count 天内 → 展示；第 3 天起结束
  const healed = { firstShownDate: '2026-08-30', lastShownDate: '2026-08-30' }
  assert.equal(shouldShowPopupNotice(notice, '2026-08-31', healed).show, true)
  assert.equal(shouldShowPopupNotice(notice, '2026-09-02', healed).show, false)
})

// ---------------------------------------------------------------------------
// tryShowPopupNotice：通用调度（minVersion + count 天每日一次 + storage 读写）
// ---------------------------------------------------------------------------

/** 内存版 storage（注入 tryShowPopupNotice 避免依赖 wx） */
function mockStorage(initial?: unknown): {
  storage: PopupNoticeStorage
  map: Map<string, unknown>
} {
  const map = new Map<string, unknown>()
  if (initial !== undefined) map.set('k', initial)
  return {
    map,
    storage: {
      get: (key: string) => map.get(key),
      set: (key: string, value: unknown) => void map.set(key, value),
    },
  }
}

const NOW = new Date(2026, 7, 30) // 2026-08-30

test('tryShowPopupNotice：首次展示 → 返回内容并写入缓存状态', () => {
  const { storage, map } = mockStorage()
  const res = tryShowPopupNotice(notice, 'k', storage, NOW)
  assert.deepEqual(res, { title: '', content: 'x', path: '/p', buttonText: '' })
  assert.deepEqual(map.get('k'), { firstShownDate: '2026-08-30', lastShownDate: '2026-08-30' })
})

test('tryShowPopupNotice：当天已展示 → 不展示且不改写缓存', () => {
  const { storage, map } = mockStorage({
    firstShownDate: '2026-08-30',
    lastShownDate: '2026-08-30',
  })
  assert.equal(tryShowPopupNotice(notice, 'k', storage, NOW), null)
  assert.deepEqual(map.get('k'), { firstShownDate: '2026-08-30', lastShownDate: '2026-08-30' })
})

test('tryShowPopupNotice：count 天内次日 → 再次展示并更新 lastShownDate', () => {
  const { storage, map } = mockStorage({
    firstShownDate: '2026-08-30',
    lastShownDate: '2026-08-30',
  })
  const res = tryShowPopupNotice(notice, 'k', storage, new Date(2026, 7, 31))
  assert.deepEqual(res, { title: '', content: 'x', path: '/p', buttonText: '' })
  assert.deepEqual(map.get('k'), { firstShownDate: '2026-08-30', lastShownDate: '2026-08-31' })
})

test('tryShowPopupNotice：满 count 天后 → 活动结束不再展示', () => {
  const { storage } = mockStorage({ firstShownDate: '2026-08-30', lastShownDate: '2026-09-01' })
  assert.equal(tryShowPopupNotice(notice, 'k', storage, new Date(2026, 8, 2)), null)
})

test('tryShowPopupNotice：minVersion 门槛拦截（不写缓存）', () => {
  const gated: PopupNotice = { content: 'x', path: '/p', minVersion: '99.0.0', count: 3 }
  const { storage, map } = mockStorage()
  assert.equal(tryShowPopupNotice(gated, 'k', storage, NOW), null)
  assert.equal(map.size, 0)
})

test('tryShowPopupNotice：自定义 title / buttonText 透传（未配置为空串）', () => {
  const customized: PopupNotice = {
    title: '自定义标题',
    content: 'x',
    path: '/p',
    buttonText: '去看看',
    minVersion: '1.0.2',
    count: 3,
  }
  const { storage } = mockStorage()
  const res = tryShowPopupNotice(customized, 'k', storage, NOW)
  assert.deepEqual(res, { title: '自定义标题', content: 'x', path: '/p', buttonText: '去看看' })
})

test('tryShowPopupNotice：notice 为空 / content 为空 → 不展示', () => {
  const { storage } = mockStorage()
  assert.equal(tryShowPopupNotice(null, 'k', storage, NOW), null)
  assert.equal(
    tryShowPopupNotice(
      { content: '', path: '/p', minVersion: '1.0.0', count: 3 },
      'k',
      storage,
      NOW,
    ),
    null,
  )
})

test('tryShowPopupNotice：storage 读取异常 → 不展示', () => {
  const throwing: PopupNoticeStorage = {
    get: () => {
      throw new Error('storage down')
    },
    set: () => {},
  }
  assert.equal(tryShowPopupNotice(notice, 'k', throwing, NOW), null)
})

test('tryShowPopupNotice：envWhitelist 不命中当前环境 → 拦截（不写缓存）', () => {
  setWxEnv('develop') // 开发版不在 ['trial', 'release'] 白名单内
  const gated: PopupNotice = {
    content: 'x',
    path: '/p',
    minVersion: '1.0.2',
    count: 3,
    envWhitelist: ['trial', 'release'],
  }
  const { storage, map } = mockStorage()
  assert.equal(tryShowPopupNotice(gated, 'k', storage, NOW), null)
  assert.equal(map.size, 0)
  setWxEnv(undefined)
})

test('tryShowPopupNotice：envWhitelist 命中当前环境 → 正常展示并写缓存', () => {
  setWxEnv('release')
  const allowed: PopupNotice = {
    content: 'x',
    path: '/p',
    minVersion: '1.0.2',
    count: 3,
    envWhitelist: ['trial', 'release'],
  }
  const { storage, map } = mockStorage()
  const res = tryShowPopupNotice(allowed, 'k', storage, NOW)
  assert.deepEqual(res, { title: '', content: 'x', path: '/p', buttonText: '' })
  assert.deepEqual(map.get('k'), { firstShownDate: '2026-08-30', lastShownDate: '2026-08-30' })
  setWxEnv(undefined)
})

test('tryShowPopupNotice：envWhitelist 空数组 / 缺省 → 不限（照常展示）', () => {
  const noLimit: PopupNotice = {
    content: 'x',
    path: '/p',
    minVersion: '1.0.2',
    count: 3,
    envWhitelist: [],
  }
  const { storage } = mockStorage()
  const res = tryShowPopupNotice(noLimit, 'k', storage, NOW)
  assert.deepEqual(res, { title: '', content: 'x', path: '/p', buttonText: '' })
})

// ---------------------------------------------------------------------------
// 历史公告状态键清理（按公告 id 的键只写不清会长期累积）
// ---------------------------------------------------------------------------

/**
 * 注入最小 wx storage mock（含键枚举），走 tryShowPopupNotice 的默认 wx storage 分支，
 * 用于验证「命中展示时清理其它公告遗留的状态键」。
 */
function setWxStorage(store: Map<string, unknown>): void {
  clearAccountInfoCache()
  ;(globalThis as Record<string, unknown>).wx = {
    getStorageSync: (key: string) => store.get(key) ?? '',
    setStorageSync: (key: string, value: unknown) => void store.set(key, value),
    getStorageInfoSync: () => ({ keys: [...store.keys()] }),
    removeStorageSync: (key: string) => void store.delete(key),
  }
}

/** 清掉 wx mock（避免影响同文件后续用例） */
function clearWxStorage(): void {
  clearAccountInfoCache()
  ;(globalThis as Record<string, unknown>).wx = undefined
}

test('tryShowPopupNotice：命中展示时清理其它公告遗留的状态键（只保留当前公告的键）', () => {
  const store = new Map<string, unknown>([
    ['popup_notice_state_5', { firstShownDate: '2026-08-01', lastShownDate: '2026-08-02' }],
    ['popup_notice_state_7', { firstShownDate: '2026-08-01', lastShownDate: '2026-08-02' }],
    // 默认键（非按 id）：不参与清理，也不该被别人清理
    ['popup_notice_state', { firstShownDate: '2026-08-01', lastShownDate: '2026-08-02' }],
    ['market_tracker_token', 'tok-123'],
  ])
  setWxStorage(store)

  const res = tryShowPopupNotice(notice, 'popup_notice_state_6', undefined, NOW)
  assert.deepEqual(res, { title: '', content: 'x', path: '/p', buttonText: '' })
  assert.deepEqual(store.get('popup_notice_state_6'), {
    firstShownDate: '2026-08-30',
    lastShownDate: '2026-08-30',
  })
  assert.equal(store.has('popup_notice_state_5'), false, '换公告后旧公告的状态键应被清理')
  assert.equal(store.has('popup_notice_state_7'), false, '换公告后旧公告的状态键应被清理')
  assert.equal(store.has('popup_notice_state'), true, '默认键不按公告 id 区分，不应被清理')
  assert.equal(store.get('market_tracker_token'), 'tok-123', '其它业务键不受影响')
  clearWxStorage()
})

test('tryShowPopupNotice：默认键（非按 id）命中时不清理由 id 的公告状态键', () => {
  const store = new Map<string, unknown>([
    ['popup_notice_state_5', { firstShownDate: '2026-08-01', lastShownDate: '2026-08-02' }],
  ])
  setWxStorage(store)

  tryShowPopupNotice(notice, 'popup_notice_state', undefined, NOW)
  assert.equal(store.has('popup_notice_state_5'), true, '默认键调用方不应误删按 id 的状态键')
  clearWxStorage()
})

test('tryShowPopupNotice：被频次拦截（未展示、未写状态）时不清理任何键', () => {
  const store = new Map<string, unknown>([
    ['popup_notice_state_6', { firstShownDate: '2026-08-30', lastShownDate: '2026-08-30' }],
    ['popup_notice_state_5', { firstShownDate: '2026-08-01', lastShownDate: '2026-08-02' }],
  ])
  setWxStorage(store)

  assert.equal(tryShowPopupNotice(notice, 'popup_notice_state_6', undefined, NOW), null)
  assert.equal(store.has('popup_notice_state_5'), true)
  clearWxStorage()
})
