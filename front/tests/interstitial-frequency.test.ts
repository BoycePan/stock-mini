import assert from 'node:assert/strict'
import test from 'node:test'

import {
  consumeDailyShow,
  daysSinceCreated,
  isNewUser,
  isValidDailyState,
  todayShownCount,
  userDailyCap,
} from '../utils/interstitial-frequency.ts'

/** 与 config/interstitial-ad.ts 默认值对齐（独立传参便于回归） */
const CONFIG = { newUserWindowDays: 3, newUserDailyCap: 1, regularDailyCap: 3 }

// ---------------------------------------------------------------------------
// daysSinceCreated / isNewUser / userDailyCap
// ---------------------------------------------------------------------------

test('daysSinceCreated：不足 24h 记 0 天', () => {
  const now = new Date('2026-09-10T12:00:00')
  assert.equal(daysSinceCreated('2026-09-10T08:00:00', now), 0)
  assert.equal(daysSinceCreated('2026-09-10T23:00:00', now), 0)
})

test('daysSinceCreated：按整天向下取整', () => {
  const now = new Date('2026-09-10T12:00:00')
  assert.equal(daysSinceCreated('2026-09-07T00:00:00', now), 3)
  assert.equal(daysSinceCreated('2026-09-06T00:00:00', now), 4)
  assert.equal(daysSinceCreated('2026-09-01T00:00:00', now), 9)
})

test('daysSinceCreated：created_at 缺失 / 无法解析返回无穷（上层按老用户）', () => {
  const now = new Date('2026-09-10T12:00:00')
  assert.equal(daysSinceCreated(undefined, now), Number.POSITIVE_INFINITY)
  assert.equal(daysSinceCreated(null, now), Number.POSITIVE_INFINITY)
  assert.equal(daysSinceCreated('', now), Number.POSITIVE_INFINITY)
  assert.equal(daysSinceCreated('not-a-date', now), Number.POSITIVE_INFINITY)
})

test('daysSinceCreated：未来时间（时钟偏差）按 0 天处理', () => {
  const now = new Date('2026-09-10T12:00:00')
  assert.equal(daysSinceCreated('2026-09-11T00:00:00', now), 0)
})

test('新用户：注册距今天数 ≤ 窗口天数', () => {
  assert.equal(isNewUser(0, 3), true)
  assert.equal(isNewUser(3, 3), true)
  assert.equal(isNewUser(4, 3), false)
})

test('userDailyCap：新用户（≤3 天）上限 1，老用户（>3 天）上限 3', () => {
  const now = new Date('2026-09-10T12:00:00')
  const opts = { now, ...CONFIG }
  // 注册 0 / 3 天 → 新用户 1 次
  assert.equal(userDailyCap({ userCreatedAt: '2026-09-10T00:00:00', ...opts }), 1)
  assert.equal(userDailyCap({ userCreatedAt: '2026-09-07T00:00:00', ...opts }), 1)
  // 注册 4 天 → 老用户 3 次
  assert.equal(userDailyCap({ userCreatedAt: '2026-09-06T00:00:00', ...opts }), 3)
})

test('userDailyCap：取不到 created_at / 解析失败按老用户（3 次/天）处理', () => {
  const now = new Date('2026-09-10T12:00:00')
  const opts = { now, ...CONFIG }
  assert.equal(userDailyCap({ userCreatedAt: undefined, ...opts }), 3)
  assert.equal(userDailyCap({ userCreatedAt: null, ...opts }), 3)
  assert.equal(userDailyCap({ userCreatedAt: '', ...opts }), 3)
  assert.equal(userDailyCap({ userCreatedAt: 'garbage', ...opts }), 3)
})

// ---------------------------------------------------------------------------
// 当日计数状态机（consumeDailyShow / todayShownCount / isValidDailyState）
// ---------------------------------------------------------------------------

test('isValidDailyState：缺字段 / 类型不对视为非法', () => {
  assert.equal(isValidDailyState(undefined), false)
  assert.equal(isValidDailyState(null), false)
  assert.equal(isValidDailyState({ date: '2026-09-10' }), false)
  assert.equal(isValidDailyState({ count: 1 }), false)
  assert.equal(isValidDailyState({ date: '2026-09-10', count: '1' }), false)
  assert.equal(isValidDailyState({ date: '2026-09-10', count: 1 }), true)
})

test('consumeDailyShow：无记录首次展示 → 记 1 次', () => {
  assert.deepEqual(consumeDailyShow('2026-09-10', null), { date: '2026-09-10', count: 1 })
  assert.deepEqual(consumeDailyShow('2026-09-10', undefined), { date: '2026-09-10', count: 1 })
})

test('consumeDailyShow：当天连续展示递增计数', () => {
  const first = consumeDailyShow('2026-09-10', null)
  const second = consumeDailyShow('2026-09-10', first)
  const third = consumeDailyShow('2026-09-10', second)
  assert.equal(third.count, 3)
  assert.equal(third.date, '2026-09-10')
})

test('consumeDailyShow：跨天自动重置（从 1 重新计）', () => {
  const yesterday = consumeDailyShow('2026-09-09', null)
  assert.equal(consumeDailyShow('2026-09-09', yesterday).count, 2)
  const today = consumeDailyShow('2026-09-10', yesterday)
  assert.deepEqual(today, { date: '2026-09-10', count: 1 })
})

test('todayShownCount：只统计当天，跨天 / 非法记录按 0', () => {
  assert.equal(todayShownCount('2026-09-10', null), 0)
  assert.equal(todayShownCount('2026-09-10', { date: '2026-09-09', count: 2 }), 0)
  assert.equal(todayShownCount('2026-09-10', { date: '2026-09-10', count: 2 }), 2)
})

test('组合：达到上限后 consume 不再放行（调度器在计数 ≥ cap 时直接拦截）', () => {
  const today = '2026-09-10'
  let state: { date: string; count: number } | null = null
  // 新用户（cap=1）：第一次允许，计数后已达上限
  state = consumeDailyShow(today, state)
  assert.equal(state.count, 1)
  assert.equal(todayShownCount(today, state) < CONFIG.newUserDailyCap, false)
  // 老用户（cap=3）：可再展示两次
  const old = { date: today, count: 2 }
  assert.equal(todayShownCount(today, old) < CONFIG.regularDailyCap, true)
  assert.equal(todayShownCount(today, consumeDailyShow(today, old)) < CONFIG.regularDailyCap, false)
})
