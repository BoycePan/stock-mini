import assert from 'node:assert/strict'
import test from 'node:test'

import {
  candleBody,
  computeKlineRange,
  computeMA,
  formatKlineTime,
  indexToX,
  isUpKline,
  priceGridLabels,
  priceToY,
  timeLabelIndexes,
  volumeBarHeight,
} from '../utils/kline.ts'

import type { KlinePoint } from '../types/stock.ts'

function k(over: Partial<KlinePoint> = {}): KlinePoint {
  return { time: '2026-08-06', open: 10, high: 11, low: 9, close: 10.5, volume: 1000, ...over }
}

// ---------------------------------------------------------------------------
// 纵轴范围
// ---------------------------------------------------------------------------

test('computeKlineRange：取 highs 最大值 / lows 最小值并上下各留 8% 边距', () => {
  const klines = [k({ high: 11, low: 9 }), k({ high: 12, low: 8.5 }), k({ high: 10.5, low: 9.5 })]
  const { minP, maxP } = computeKlineRange(klines)
  const range = 12 - 8.5
  assert.ok(Math.abs(minP - (8.5 - range * 0.08)) < 1e-9)
  assert.ok(Math.abs(maxP - (12 + range * 0.08)) < 1e-9)
})

test('computeKlineRange：单值（min === max）上下各扩 1，再留 8% 边距，避免 0 范围', () => {
  const { minP, maxP } = computeKlineRange([k({ high: 10, low: 10 })])
  assert.equal(minP, 9 - 2 * 0.08)
  assert.equal(maxP, 11 + 2 * 0.08)
})

test('computeKlineRange：空数据 / 非有限值返回 [0, 1] 兜底', () => {
  assert.deepEqual(computeKlineRange([]), { minP: 0, maxP: 1 })
  assert.deepEqual(computeKlineRange([k({ high: Number.NaN, low: Number.NaN })]), {
    minP: 0,
    maxP: 1,
  })
})

// ---------------------------------------------------------------------------
// 坐标映射
// ---------------------------------------------------------------------------

test('priceToY：价格越高 y 越小；maxP → padT，minP → padT + priceH', () => {
  const padT = 20
  const priceH = 100
  assert.equal(priceToY(20, 0, 20, padT, priceH), padT)
  assert.equal(priceToY(0, 0, 20, padT, priceH), padT + priceH)
  // 中间值线性：10 是 [0,20] 中点 → padT + priceH/2
  assert.equal(priceToY(10, 0, 20, padT, priceH), padT + 50)
  assert.ok(priceToY(15, 0, 20, padT, priceH) < priceToY(5, 0, 20, padT, priceH))
})

test('indexToX：n=1 居中；否则在 plotW 内均匀分布', () => {
  assert.equal(indexToX(0, 1, 10, 100), 60)
  assert.equal(indexToX(0, 2, 10, 100), 10)
  assert.equal(indexToX(1, 2, 10, 100), 110)
  assert.equal(indexToX(0, 3, 10, 100), 10)
  assert.equal(indexToX(1, 3, 10, 100), 60)
  assert.equal(indexToX(2, 3, 10, 100), 110)
})

// ---------------------------------------------------------------------------
// K 线几何
// ---------------------------------------------------------------------------

test('isUpKline：收盘 >= 开盘为涨（红），否则跌（绿）；平盘视为涨', () => {
  assert.equal(isUpKline({ open: 10, close: 10.5 }), true)
  assert.equal(isUpKline({ open: 10, close: 9.5 }), false)
  assert.equal(isUpKline({ open: 10, close: 10 }), true)
})

test('candleBody：顶/底按开收大小排序，实体高度最小 1px（十字星可见）', () => {
  assert.deepEqual(candleBody(20, 10), { top: 10, bottom: 20, height: 10 })
  assert.deepEqual(candleBody(10, 20), { top: 10, bottom: 20, height: 10 })
  // 十字星（开收同价）：高度 1px
  assert.deepEqual(candleBody(10, 10), { top: 10, bottom: 10, height: 1 })
})

// ---------------------------------------------------------------------------
// 移动平均
// ---------------------------------------------------------------------------

test('computeMA：前 period-1 个为 null，其余为滑动窗口收盘均值', () => {
  const klines = [10, 11, 12, 13, 14].map((close) => k({ close }))
  const ma5 = computeMA(klines, 5)
  assert.deepEqual(ma5, [null, null, null, null, 12])
  const ma3 = computeMA(klines, 3)
  assert.deepEqual(ma3, [null, null, 11, 12, 13])
  // MA1 就是收盘价
  assert.deepEqual(computeMA(klines, 1), [10, 11, 12, 13, 14])
})

test('computeMA：period <= 0 或空数据返回全 null', () => {
  assert.deepEqual(computeMA([], 5), [])
  assert.deepEqual(computeMA([k({ close: 10 })], 0), [null])
  assert.deepEqual(computeMA([k({ close: 10 })], -1), [null])
})

// ---------------------------------------------------------------------------
// 刻度
// ---------------------------------------------------------------------------

test('priceGridLabels：count 个自上而下等分价格，首=maxP 尾=minP', () => {
  const labels = priceGridLabels(0, 100, 5)
  assert.deepEqual(labels, [100, 75, 50, 25, 0])
})

test('timeLabelIndexes：均匀覆盖 0..n-1，首=0 尾=n-1', () => {
  assert.deepEqual(timeLabelIndexes(30, 5), [0, 7, 15, 22, 29])
  assert.deepEqual(timeLabelIndexes(1, 5), [0])
  assert.deepEqual(timeLabelIndexes(0, 5), [])
  assert.deepEqual(timeLabelIndexes(10, 1), [0])
})

test('formatKlineTime：日线 / 分钟线时间都取 MM-DD', () => {
  assert.equal(formatKlineTime('2026-08-06'), '08-06')
  assert.equal(formatKlineTime('2026-08-05 14:55:00'), '08-05')
  assert.equal(formatKlineTime('2026-08-06 00:00'), '08-06')
  assert.equal(formatKlineTime('bad'), 'bad')
})

// ---------------------------------------------------------------------------
// 成交量
// ---------------------------------------------------------------------------

test('volumeBarHeight：按 volMax 等比缩放并封顶，0 量为 0', () => {
  assert.equal(volumeBarHeight(5000, 10000, 100), 50)
  assert.equal(volumeBarHeight(10000, 10000, 100), 100)
  assert.equal(volumeBarHeight(20000, 10000, 100), 100, '超过 volMax 封顶')
  assert.equal(volumeBarHeight(0, 10000, 100), 0)
  assert.equal(volumeBarHeight(5000, 0, 100), 0, 'volMax 为 0 兜底不除零')
})

// ---------------------------------------------------------------------------
// 布局端到端校验：模拟组件 renderChart 的布局，验证每根 K 线的
// 影线（high/low）与实体（open/close）都落在价格区内，不溢出画布
// ---------------------------------------------------------------------------

test('布局端到端：所有 K 线 high/low 映射 y 均在价格区内，x 均在绘图区内', () => {
  const width = 340
  const height = 220
  const klines = [10, 11, 12, 13, 14].map((close) =>
    k({ open: close - 0.5, high: close + 1, low: close - 1.5, close, volume: 1000 }),
  )
  const n = klines.length
  const { minP, maxP } = computeKlineRange(klines, 0.06)

  // 复刻组件布局常量
  const gridLabels = priceGridLabels(minP, maxP, 5)
  let padL = 0
  for (const v of gridLabels) {
    const w = String(v.toFixed(2)).length * 6
    if (w > padL) padL = w
  }
  padL = Math.min(110, Math.max(48, padL + 14))
  const padR = 8
  const padT = 22
  const padB = 18
  const volH = Math.max(30, Math.round(height * 0.22))
  const priceH = height - padT - padB - volH - 10
  const plotW = width - padL - padR

  for (let i = 0; i < n; i += 1) {
    const item = klines[i]
    if (!item) continue
    const x = indexToX(i, n, padL, plotW)
    // x 在绘图区内（含柱宽余量）
    assert.ok(x >= padL && x <= padL + plotW, `第 ${i} 根 x=${x} 超出绘图区`)
    // 影线范围：high 的 y 最小（在最上），low 的 y 最大（在最下）
    const yHigh = priceToY(item.high, minP, maxP, padT, priceH)
    const yLow = priceToY(item.low, minP, maxP, padT, priceH)
    assert.ok(yHigh <= yLow, `第 ${i} 根 high(${yHigh}) 应在上、low(${yLow}) 应在下`)
    assert.ok(yHigh >= padT - 0.5 && yLow <= padT + priceH + 0.5, `第 ${i} 根影线超出价格区`)
    // 实体夹在影线之间
    const yOpen = priceToY(item.open, minP, maxP, padT, priceH)
    const yClose = priceToY(item.close, minP, maxP, padT, priceH)
    assert.ok(yOpen >= yHigh - 0.5 && yOpen <= yLow + 0.5, `第 ${i} 根 open 应夹在 high/low 之间`)
    assert.ok(
      yClose >= yHigh - 0.5 && yClose <= yLow + 0.5,
      `第 ${i} 根 close 应夹在 high/low 之间`,
    )
  }
})
