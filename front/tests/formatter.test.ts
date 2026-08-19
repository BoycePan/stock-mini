import assert from 'node:assert/strict'
import test from 'node:test'

import { formatItemUpdatedAt, formatUpdatedAt } from '../utils/formatter.ts'

test('formatUpdatedAt 输出 HH:mm 更新', () => {
  const d = new Date(2026, 7, 19, 9, 5, 0) // 2026-08-19 09:05（本地时区）
  assert.equal(formatUpdatedAt(d), '09:05 更新')
})

test('formatItemUpdatedAt 当天只显示时分', () => {
  const now = new Date()
  const sameDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 14, 30, 0)
  assert.equal(formatItemUpdatedAt(sameDay), '14:30 更新')
})

test('formatItemUpdatedAt 跨天补日期到分', () => {
  // 固定一个过去的日期（本地时区 2026-01-02 08:07）
  const old = new Date(2026, 0, 2, 8, 7, 0)
  assert.equal(formatItemUpdatedAt(old), '01-02 08:07 更新')
})

test('formatItemUpdatedAt 非法/空值返回空串', () => {
  assert.equal(formatItemUpdatedAt(undefined), '')
  assert.equal(formatItemUpdatedAt(''), '')
  assert.equal(formatItemUpdatedAt('not-a-date'), '')
  assert.equal(formatItemUpdatedAt(Number.NaN), '')
})

test('formatItemUpdatedAt 接受 epoch 毫秒', () => {
  const now = new Date()
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 10, 3, 0)
  assert.equal(formatItemUpdatedAt(d.getTime()), '10:03 更新')
})
