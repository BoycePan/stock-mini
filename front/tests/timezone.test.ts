import assert from 'node:assert/strict'
import test from 'node:test'

import { quoteTimeToDate, quoteTimeToUtcMs } from '../utils/quote-parser.ts'
import { formatNewsTime } from '../utils/formatter.ts'

/**
 * 时区无关性回归：行情时间与新闻时间都是「东八区墙钟字符串」（后端 / 上游串内不带时区标记），
 * 但历史实现按**设备本地时区**解析，导致非 UTC+8 设备结果整体偏移 (本地时区偏移 − 8h)：
 * - 行情新鲜度（90min 内视为活跃）：偏西设备算出负年龄 → 恒判新鲜 → 收盘/周末仍报「A股盘中」；
 * - 新闻相对时间：偏西设备 diff 变负 → 所有新闻恒显示「刚刚」。
 *
 * 这两个函数的正确性必须与运行设备时区无关，因此用例只断言**不变量**，
 * 不在用例内依赖本机时区（可在 TZ=America/Los_Angeles 等环境下复跑验证）。
 */

const BEIJING_OFFSET_MS = 8 * 60 * 60 * 1000

test('quoteTimeToUtcMs：北京墙钟还原为真实时刻，与设备时区无关', () => {
  // 墙钟字段（2026-08-26 17:29:55 北京时间）→ 真实时刻恒为 UTC 09:29:55
  const wallClockAsLocal = new Date(2026, 7, 26, 17, 29, 55)
  const expected = Date.UTC(2026, 7, 26, 17, 29, 55) - BEIJING_OFFSET_MS
  assert.equal(quoteTimeToUtcMs(wallClockAsLocal), expected)
  assert.equal(new Date(expected).toISOString(), '2026-08-26T09:29:55.000Z')

  // 与 quoteTimeToDate（按本地时区构造）串联后同样还原正确
  const parsed = quoteTimeToDate('2026-08-26 17:29:55')
  assert.ok(parsed, '应能解析「yyyy-MM-dd HH:mm:ss」')
  assert.equal(quoteTimeToUtcMs(parsed), expected)

  // 紧凑格式与 14 位格式走同一路径，也应还原为同一时刻
  assert.equal(quoteTimeToUtcMs(quoteTimeToDate('20260826172955')!), expected)
  assert.equal(quoteTimeToUtcMs(quoteTimeToDate('2026-08-26T17:29:55')!), expected)
})

test('quoteTimeToUtcMs：同一天内不同墙钟时刻的先后顺序保持不变', () => {
  const a = quoteTimeToUtcMs(quoteTimeToDate('2026-08-26 09:30:00')!)
  const b = quoteTimeToUtcMs(quoteTimeToDate('2026-08-26 15:00:00')!)
  assert.ok(a < b, '上午应早于下午')
  assert.equal(b - a, 5.5 * 60 * 60 * 1000, 'A股上午到收盘应为 5.5 小时')
})

test('formatNewsTime：相对时间与展示文案与设备时区无关', () => {
  // 固定 now = 北京时间 2026-08-26 18:00（真实时刻 UTC 10:00）
  const now = new Date(Date.UTC(2026, 7, 26, 10, 0, 0))
  assert.equal(formatNewsTime('2026-08-26 17:50', now), '10分钟前')
  assert.equal(formatNewsTime('2026-08-26 15:00', now), '3小时前')
  // 跨天：仍按北京时间展示，与本地时区无关
  assert.equal(formatNewsTime('2026-08-25 23:30', now), '08-25 23:30')
  // 跨年补年份
  assert.equal(formatNewsTime('2025-12-31 09:05', now), '2025-12-31 09:05')
})

test('formatNewsTime：非法/缺省输入行为不变', () => {
  const now = new Date(Date.UTC(2026, 7, 26, 10, 0, 0))
  assert.equal(formatNewsTime('', now), '')
  // 非「yyyy-MM-dd HH:mm」格式原样返回
  assert.equal(formatNewsTime('刚刚', now), '刚刚')
  // 晚于当前（时钟偏差）按「刚刚」处理
  assert.equal(formatNewsTime('2026-08-26 18:30', now), '刚刚')
})
