import assert from 'node:assert/strict'
import test from 'node:test'

import { formatChange, formatItemUpdatedAt, formatUpdatedAt } from '../utils/formatter.ts'

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

// ---------------------------------------------------------------------------
// formatChange：±0 归一（-0% / +0% 与精确 0 的「0%」口径统一）
// ---------------------------------------------------------------------------

test('formatChange：数值上等于 0 的结果统一输出「0%」（不再出现 -0% / +0%）', () => {
  // 成因：|change| < 0.0001 走 4 位小数分支——(-0.00001).toFixed(4) = "-0.0000" → 去尾零得 "-0"，
  // 0.00001 → "0.0000" → "0"，直接拼符号会得到 "-0%" / "+0%"，与精确 0 的 "0%" 不一致。
  assert.equal(formatChange(-0.00001), '0%')
  assert.equal(formatChange(0.00001), '0%')
  assert.equal(formatChange(0), '0%')
  assert.equal(formatChange(-0), '0%')
  // 四舍五入到 0.00 的小幅波动同理（旧实现分别输出 "-0%" / "+0%"）
  assert.equal(formatChange(-0.004), '0%')
  assert.equal(formatChange(0.004), '0%')
  assert.equal(formatChange(-0.0002), '0%')
})

test('formatChange：仍能区分真正的涨 / 跌 / 微涨（不误伤非零结果）', () => {
  // 4 位小数分支：极小的真实波动仍带符号展示
  assert.equal(formatChange(0.00006), '+0.0001%')
  assert.equal(formatChange(-0.00006), '-0.0001%')
  // 既有口径不变
  assert.equal(formatChange(1.5), '+1.5%')
  assert.equal(formatChange(1), '+1%')
  assert.equal(formatChange(0.5), '+0.5%')
  assert.equal(formatChange(-1.25), '-1.25%')
  assert.equal(formatChange(Number.NaN), '--')
  assert.equal(formatChange(Number.POSITIVE_INFINITY), '--')
})
