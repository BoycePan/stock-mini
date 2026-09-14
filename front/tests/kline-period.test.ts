import assert from 'node:assert/strict'
import test from 'node:test'

import {
  aggregateKlines,
  computeEMA,
  computeMACD,
  computeMA,
  formatKlineAxisLabel,
  hasMacdData,
  klineBucketKey,
  MACD_MIN_BARS,
  parseKlineDate,
} from '../utils/kline.ts'
import type { KlinePoint } from '../types/stock.ts'

function k(time: string, open: number, close: number, extra: Partial<KlinePoint> = {}): KlinePoint {
  return {
    time,
    open,
    close,
    high: Math.max(open, close) + 1,
    low: Math.min(open, close) - 1,
    volume: 100,
    ...extra,
  }
}

// ---------------------------------------------------------------------------
// 时间解析 / 分组键
// ---------------------------------------------------------------------------

test('parseKlineDate：解析 "YYYY-MM-DD" 前缀（含带时分秒 / 带空格的分钟线时间）', () => {
  assert.deepEqual(parseKlineDate('2026-08-06'), { y: 2026, m: 8, d: 6 })
  assert.deepEqual(parseKlineDate('2026-08-06 14:55:00'), { y: 2026, m: 8, d: 6 })
  assert.equal(parseKlineDate('2026-13-01'), null)
  assert.equal(parseKlineDate('bad'), null)
})

test('klineBucketKey：周键为该周周一（周日属上一周）、月键 YYYY-MM、年键 YYYY', () => {
  // 2026-08-06 是周四 → 该周周一 2026-08-03
  assert.equal(klineBucketKey('2026-08-06', 'week'), '2026-08-03')
  // 2026-08-09 是周日 → 归到 2026-08-03 那一周
  assert.equal(klineBucketKey('2026-08-09', 'week'), '2026-08-03')
  assert.equal(klineBucketKey('2026-08-10', 'week'), '2026-08-10')
  assert.equal(klineBucketKey('2026-08-06', 'month'), '2026-08')
  assert.equal(klineBucketKey('2026-08-06', 'year'), '2026')
  assert.equal(klineBucketKey('bad', 'month'), null)
})

// ---------------------------------------------------------------------------
// 周期聚合（年 K 唯一的实现路径）
// ---------------------------------------------------------------------------

test('aggregateKlines：周聚合取区间首开末收 / 极高极低 / 量额求和，时间归属末根', () => {
  const daily = [
    k('2026-08-03', 10, 11, { volume: 10, amount: 100 }),
    k('2026-08-04', 11, 12, { volume: 20, amount: 200 }),
    k('2026-08-05', 12, 9, { volume: 30, amount: 300 }),
    // 下一周
    k('2026-08-10', 9, 10, { volume: 40, amount: 400 }),
    k('2026-08-11', 10, 13, { volume: 50, amount: 500 }),
  ]
  const weekly = aggregateKlines(daily, 'week')
  assert.equal(weekly.length, 2)
  assert.equal(weekly[0]?.time, '2026-08-05', '时间取区间末根')
  assert.equal(weekly[0]?.open, 10)
  assert.equal(weekly[0]?.close, 9)
  assert.equal(weekly[0]?.high, 13, '最高取区间极值（12+1 / 11+1）')
  assert.equal(weekly[0]?.low, 8, '最低取区间极值（9-1 / 10-1）')
  assert.equal(weekly[0]?.volume, 60)
  assert.equal(weekly[0]?.amount, 600)
  assert.equal(weekly[1]?.open, 9)
  assert.equal(weekly[1]?.close, 13)
})

test('aggregateKlines：月/年聚合（跨月跨年的历史年份），并跳过无法解析时间的根', () => {
  const daily = [
    k('2025-12-30', 10, 10),
    k('2025-12-31', 10, 11),
    k('2026-01-05', 11, 12),
    k('2026-02-02', 12, 13),
    k('bad-time', 999, 999),
  ]
  const monthly = aggregateKlines(daily, 'month')
  assert.deepEqual(
    monthly.map((bar) => bar.time),
    ['2025-12-31', '2026-01-05', '2026-02-02'],
  )
  const yearly = aggregateKlines(daily, 'year')
  assert.equal(yearly.length, 2)
  assert.equal(yearly[0]?.close, 11)
  assert.equal(yearly[1]?.close, 13)
  assert.equal(yearly[1]?.open, 11)
})

test('aggregateKlines：空数组 / 单根返回可画数据，非有限价格被过滤', () => {
  assert.deepEqual(aggregateKlines([], 'month'), [])
  const one = aggregateKlines([k('2026-08-06', 10, 11)], 'month')
  assert.equal(one.length, 1)
  assert.equal(one[0]?.close, 11)
  const dirty = aggregateKlines(
    [k('2026-08-06', 10, 11), { ...k('2026-08-07', 10, 11), close: Number.NaN }],
    'month',
  )
  assert.equal(dirty.length, 1, 'NaN 收盘的根被跳过')
})

test('formatKlineAxisLabel：日/周取 MM-DD、月取 YY-MM、年取 YYYY', () => {
  assert.equal(formatKlineAxisLabel('2026-08-06', 'day'), '08-06')
  assert.equal(formatKlineAxisLabel('2026-08-06', 'week'), '08-06')
  assert.equal(formatKlineAxisLabel('2026-08-31', 'month'), '26-08')
  assert.equal(formatKlineAxisLabel('2026-12-31', 'year'), '2026')
})

// ---------------------------------------------------------------------------
// MACD
// ---------------------------------------------------------------------------

test('computeEMA：首个有效值为种子，其后按 2/(n+1) 平滑', () => {
  const ema = computeEMA([10, 20], 2)
  // alpha = 2/3 → 10, 10*1/3 + 20*2/3 = 16.666...
  assert.equal(ema[0], 10)
  assert.ok(Math.abs((ema[1] ?? 0) - 16.6666666) < 1e-6)
  const flat = computeEMA([5, 5, 5], 12)
  assert.deepEqual(flat, [5, 5, 5], '常数序列 EMA 恒等于该常数')
})

test('computeMACD：DIF = EMA12 - EMA26、DEA = EMA9(DIF)、柱 = 2×(DIF-DEA)', () => {
  const klines = Array.from({ length: 60 }, (_, i) =>
    k(`2026-01-${String(i + 1).padStart(2, '0')}`, 10 + i, 10 + i),
  )
  const macd = computeMACD(klines)
  assert.equal(macd.dif.length, 60)
  assert.equal(macd.dea.length, 60)
  assert.equal(macd.hist.length, 60)
  // 单调上涨序列：DIF 应为正（快线在慢线之上）
  assert.ok((macd.dif[59] ?? 0) > 0)
  for (let i = 0; i < 60; i += 1) {
    const expect = 2 * ((macd.dif[i] ?? 0) - (macd.dea[i] ?? 0))
    assert.ok(Math.abs((macd.hist[i] ?? 0) - expect) < 1e-9)
  }
})

test('computeMACD：常数序列 DIF / DEA / 柱 全为 0（无趋势时无信号）', () => {
  const klines = Array.from({ length: 40 }, () => k('2026-01-01', 10, 10))
  const macd = computeMACD(klines)
  assert.ok(Math.abs(macd.dif[39] ?? 1) < 1e-9)
  assert.ok(Math.abs(macd.dea[39] ?? 1) < 1e-9)
  assert.ok(Math.abs(macd.hist[39] ?? 1) < 1e-9)
})

test('hasMacdData：不足 slow + signal - 1 根时隐藏 MACD 面板', () => {
  const make = (n: number) =>
    Array.from({ length: n }, (_, i) =>
      k(`2026-01-${String((i % 28) + 1).padStart(2, '0')}`, 10, 11),
    )
  assert.equal(MACD_MIN_BARS, 34)
  assert.equal(hasMacdData(make(33)), false)
  assert.equal(hasMacdData(make(34)), true)
  assert.equal(hasMacdData(make(0)), false)
})

// ---------------------------------------------------------------------------
// MA 复用校验（年 K 聚合后仍要能画均线）
// ---------------------------------------------------------------------------

test('聚合后的月线可正常计算 MA（不足周期为 null，不抛错）', () => {
  const daily = Array.from({ length: 12 * 8 }, (_, i) =>
    k(`2026-${String((i % 12) + 1).padStart(2, '0')}-01`, 10 + i, 10 + i),
  )
  const monthly = aggregateKlines(daily, 'month')
  const ma5 = computeMA(monthly, 5)
  assert.equal(ma5.length, monthly.length)
  assert.ok(ma5.slice(0, 4).every((v) => v === null))
})
