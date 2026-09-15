import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildQuoteChartLayout,
  hitTestIndex,
  isKlineMode,
  klinePeriodOf,
  MA_PERIODS,
  type ChartCtx,
  type QuoteChartData,
} from '../packageQuote/components/quote-chart/draw.ts'
import {
  buildKlineView,
  clampViewport,
  DEFAULT_VIEW_BARS,
  defaultViewport,
  dragViewport,
  MIN_VIEW_BARS,
  panViewport,
  pinchViewport,
  zoomViewport,
} from '../utils/kline-viewport.ts'
import { fitMaLegend } from '../utils/kline-legend.ts'
import { minuteDayLabel, minutePointDate, splitMinuteDays } from '../utils/minute-session.ts'
import type { KlinePoint, MinutePoint } from '../types/stock.ts'

/** 最小 canvas 2d 替身：只统计 measureText（布局用它决定左侧留白） */
function fakeCtx(): ChartCtx {
  const noop = () => {}
  return {
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    font: '',
    textAlign: 'left',
    clearRect: noop,
    scale: noop,
    fillRect: noop,
    beginPath: noop,
    closePath: noop,
    moveTo: noop,
    lineTo: noop,
    rect: noop,
    arc: noop,
    arcTo: noop,
    fill: noop,
    stroke: noop,
    fillText: noop,
    measureText: (text: string) => ({ width: text.length * 5 }),
    setLineDash: noop,
  }
}

function kline(time: string, base: number): KlinePoint {
  return {
    time,
    open: base,
    close: base + 0.5,
    high: base + 1,
    low: base - 1,
    volume: 1000,
  }
}

function minutePoint(time: string, price: number, timeFull?: string): MinutePoint {
  return { time, timeFull, price, avg: price, volume: 100 }
}

function dayPoints(date: string, n = 240): MinutePoint[] {
  const points: MinutePoint[] = []
  for (let i = 0; i < n; i += 1) {
    const hh = String(9 + Math.floor((30 + i) / 60)).padStart(2, '0')
    const mm = String((30 + i) % 60).padStart(2, '0')
    const time = `${hh}:${mm}`
    points.push(minutePoint(time, 10 + Math.sin(i / 20) * 0.2, `${date} ${time}`))
  }
  return points
}

function baseData(over: Partial<QuoteChartData> = {}): QuoteChartData {
  return {
    mode: 'day',
    width: 340,
    height: 470,
    isDark: false,
    points: [],
    preClose: 0,
    session: 'continuous',
    klines: Array.from({ length: 120 }, (_, i) =>
      kline(`2026-01-${String((i % 28) + 1).padStart(2, '0')}`, 10 + (i % 7)),
    ),
    activeIndex: null,
    ...over,
  }
}

// ---------------------------------------------------------------------------
// 模式判定
// ---------------------------------------------------------------------------

test('isKlineMode / klinePeriodOf：只有日周月年走 K 线，分时与五日走分时链路', () => {
  assert.equal(isKlineMode('minute'), false)
  assert.equal(isKlineMode('fiveDay'), false)
  assert.equal(isKlineMode('day'), true)
  assert.equal(isKlineMode('year'), true)
  assert.equal(klinePeriodOf('month'), 'month')
  assert.equal(klinePeriodOf('minute'), 'day', '非 K 线模式回退 day（仅用于类型收窄）')
})

// ---------------------------------------------------------------------------
// 布局：三块面板不重叠、不越界；无数据的面板自动隐藏且价格面板占满
// ---------------------------------------------------------------------------

test('K 线布局：价格 / 成交量 / MACD 三块面板自上而下排列且都在画布内', () => {
  const ctx = fakeCtx()
  const layout = buildQuoteChartLayout(baseData(), ctx)
  assert.equal(layout.showVolume, true)
  assert.equal(layout.showMacd, true, '120 根 > MACD_MIN_BARS → 展示 MACD')
  assert.ok(layout.priceH > 0)
  assert.ok(layout.priceTop + layout.priceH < layout.volTop, '成交量面板在价格面板下方')
  assert.ok(layout.volTop + layout.volH < layout.macdTop, 'MACD 面板在成交量面板下方')
  assert.ok(layout.macdTop + layout.macdH <= 470, 'MACD 面板不超出画布')
  assert.ok(layout.padL >= 54 && layout.padL <= 120)
  assert.equal(layout.volMax, 1000)
  assert.ok(layout.macdMax > 0)
  assert.equal(layout.maSeries.length, 4, 'MA5 / MA20 / MA30 / MA60 四条')
  assert.deepEqual(layout.maPeriods, [5, 20, 30, 60])
})

test('K 线布局：K 线不足 MACD 根数时隐藏 MACD，价格面板吃掉这块高度（不留空白）', () => {
  const ctx = fakeCtx()
  const few = baseData({
    klines: Array.from({ length: 20 }, (_, i) => kline('2026-01-01', 10 + i)),
  })
  const withMacd = buildQuoteChartLayout(baseData(), ctx)
  const withoutMacd = buildQuoteChartLayout(few, ctx)
  assert.equal(withoutMacd.showMacd, false)
  assert.equal(withoutMacd.macdH, 0)
  assert.equal(withoutMacd.macdTop, withoutMacd.volTop + withoutMacd.volH + 15)
  assert.ok(
    withoutMacd.priceH > withMacd.priceH + 80,
    `隐藏 MACD 后价格面板应显著变高（${withoutMacd.priceH} vs ${withMacd.priceH}）`,
  )
})

test('K 线布局：无成交量标的（外汇等）隐藏成交量面板，价格面板占满', () => {
  const ctx = fakeCtx()
  const noVol = baseData({
    klines: Array.from({ length: 60 }, (_, i) => ({ ...kline('2026-01-01', 10 + i), volume: 0 })),
  })
  const layout = buildQuoteChartLayout(noVol, ctx)
  assert.equal(layout.showVolume, false)
  assert.equal(layout.volH, 0)
  assert.equal(layout.macdTop, layout.volTop, '成交量隐藏后 MACD 直接接在价格面板下方')
  assert.ok(layout.priceH > 200)
})

test('分时布局：有昨收时纵轴以昨收为中心（上下等幅），中间刻度为 0%', () => {
  const ctx = fakeCtx()
  const points = dayPoints('2026-09-14')
  const layout = buildQuoteChartLayout(
    baseData({ mode: 'minute', points, preClose: 10, session: 'continuous' }),
    ctx,
  )
  assert.equal(layout.showMacd, false, '分时不出 MACD')
  assert.ok(Math.abs((layout.minP + layout.maxP) / 2 - 10) < 1e-9, '纵轴中心等于昨收')
  assert.equal(layout.xs.length, points.length)
  assert.ok(layout.xs[0] === layout.padL)
  // 连续交易：等分拉伸
  assert.equal(layout.padded, null)
})

test('分时布局：A股时段按真实时钟铺点，未收盘时右侧留白', () => {
  const ctx = fakeCtx()
  // 只到 10:00（早于收盘）→ 最后一点的 x 应贴近左侧，右侧留给未来分钟
  const points: MinutePoint[] = []
  for (let i = 0; i < 31; i += 1) {
    const minute = 570 + i // 09:30 起 31 分钟
    const hh = String(Math.floor(minute / 60)).padStart(2, '0')
    const mm = String(minute % 60).padStart(2, '0')
    points.push(minutePoint(`${hh}:${mm}`, 10, `2026-09-14 ${hh}:${mm}`))
  }
  const layout = buildQuoteChartLayout(
    baseData({ mode: 'minute', points, preClose: 10, session: 'ashare' }),
    ctx,
  )
  assert.ok(layout.padded, 'A股首点为 09:30 → 命中固定时段网格')
  const lastX = layout.xs[layout.xs.length - 1] ?? 0
  assert.ok(
    lastX < layout.padL + layout.plotW * 0.2,
    `09:30-10:00 只占全时段约 6%，末点 x=${lastX} 应贴近左侧`,
  )
})

test('五日布局：按自然日分段（5 段）并给出 5 个日期刻度，且不按时段铺点', () => {
  const ctx = fakeCtx()
  const dates = ['2026-09-08', '2026-09-09', '2026-09-10', '2026-09-11', '2026-09-14']
  const points = dates.flatMap((date) => dayPoints(date, 60))
  const layout = buildQuoteChartLayout(
    baseData({ mode: 'fiveDay', points, preClose: 10, session: 'continuous' }),
    ctx,
  )
  assert.equal(layout.padded, null, '五日不做时段铺点')
  assert.equal(layout.days.length, 5)
  assert.deepEqual(
    layout.xTicks.map((tick) => tick.text),
    dates.map((date) => minuteDayLabel(date)),
  )
  assert.ok(layout.showMacd === false, '五日不出 MACD')
  for (let i = 1; i < layout.xs.length; i += 1) {
    assert.ok((layout.xs[i] ?? 0) >= (layout.xs[i - 1] ?? 0), 'x 坐标必须单调不减')
  }
})

// ---------------------------------------------------------------------------
// K 线可见窗口：默认 30 根 + 缩放 / 平移 + 均线与 MACD 的全量预热
// ---------------------------------------------------------------------------

/** 造 n 根带波动的日 K（时间字符串只用于刻度文案断言） */
function klineSeries(n: number): KlinePoint[] {
  return Array.from({ length: n }, (_, i) => {
    const day = String((i % 28) + 1).padStart(2, '0')
    return kline(`2026-01-${day}`, 10 + Math.sin(i / 9) * 2)
  })
}

test('buildKlineView：默认只取最近 30 根，均线在全量上算完再切片（MA60 不被窗口截断）', () => {
  const all = klineSeries(200)
  const view = buildKlineView(all, DEFAULT_VIEW_BARS, all.length - 1)
  assert.equal(DEFAULT_VIEW_BARS, 30)
  assert.equal(view.total, 200)
  assert.equal(view.klines.length, DEFAULT_VIEW_BARS)
  assert.equal(view.start, 200 - DEFAULT_VIEW_BARS)
  assert.equal(view.end, 199)
  assert.deepEqual(view.maPeriods, [...MA_PERIODS])
  assert.equal(view.maSeries.length, 4)
  for (const series of view.maSeries) assert.equal(series.length, view.klines.length)
  assert.ok(
    view.maSeries[3]?.every((v) => v !== null),
    'MA60 在窗口内每根都有值：预热来自窗口外的历史',
  )
  assert.equal(view.klines[0]?.time, all[170]?.time, '窗口第一根 = 全量第 170 根')
  assert.equal(view.showMacdPanel, true, 'MACD 是否可画按全量根数判定')
  assert.equal(view.macd?.dif.length, DEFAULT_VIEW_BARS)
})

test('buildKlineView：窗口贴到历史起点时自动右移（始终有 30 根可画）', () => {
  const all = klineSeries(50)
  const view = buildKlineView(all, DEFAULT_VIEW_BARS, 0)
  assert.equal(view.start, 0)
  assert.equal(view.end, DEFAULT_VIEW_BARS - 1)
  assert.equal(view.klines.length, DEFAULT_VIEW_BARS)
  assert.ok(
    view.maSeries[3]?.every((v) => v === null),
    '第 1~30 根历史不足 → MA60 全 null',
  )
})

test('buildKlineView：根数少于窗口 / 空数据都不越界', () => {
  const few = buildKlineView(klineSeries(8), DEFAULT_VIEW_BARS, 7)
  assert.equal(few.klines.length, 8)
  assert.equal(few.start, 0)
  assert.equal(few.showMacdPanel, false, '8 根 < MACD 最小根数')
  const empty = buildKlineView([], DEFAULT_VIEW_BARS, 0)
  assert.equal(empty.klines.length, 0)
  assert.equal(empty.end, -1)
  assert.equal(empty.showMacdPanel, false)
})

test('zoomViewport / panViewport：缩放夹在 [10, 全量]，平移夹在首尾且窗口宽度不变', () => {
  const total = 200
  let state = clampViewport(total, DEFAULT_VIEW_BARS, total - 1)
  assert.deepEqual(state, { viewBars: 30, viewEnd: 199 })

  state = zoomViewport(total, state, 'in')
  assert.equal(state.viewBars, 21)
  assert.equal(state.viewEnd, 199, '缩放右端锚定')
  for (let i = 0; i < 10; i += 1) state = zoomViewport(total, state, 'in')
  assert.equal(state.viewBars, MIN_VIEW_BARS, '放大到极限不小于 MIN_VIEW_BARS')
  const atLimit = zoomViewport(total, state, 'in')
  assert.equal(atLimit.viewBars, MIN_VIEW_BARS, '到极限后不再变化（按钮置灰）')
  for (let i = 0; i < 20; i += 1) state = zoomViewport(total, state, 'out')
  assert.equal(state.viewBars, total, '缩小到极限 = 展示全部')
  assert.equal(state.viewEnd, total - 1)

  let pan = clampViewport(total, 30, 199)
  pan = panViewport(total, pan, 'left')
  assert.equal(pan.viewEnd, 199 - 18, '左移步长 = 窗口宽度 60%')
  assert.equal(pan.viewBars, 30, '平移不改变窗口宽度')
  for (let i = 0; i < 20; i += 1) pan = panViewport(total, pan, 'left')
  assert.equal(pan.viewEnd, 29, '贴到历史起点（窗口 0~29）')
  for (let i = 0; i < 30; i += 1) pan = panViewport(total, pan, 'right')
  assert.equal(pan.viewEnd, total - 1, '回到最新一根')
})

test('分片布局：可见 30 根的 x 坐标铺满绘图区，纵向范围只按窗口内价格算', () => {
  const ctx = fakeCtx()
  const all = klineSeries(200)
  const full = buildQuoteChartLayout(baseData({ klines: all }), ctx)
  const view = buildKlineView(all, DEFAULT_VIEW_BARS, all.length - 1)
  const sliced = buildQuoteChartLayout(
    baseData({
      klines: view.klines,
      maSeries: view.maSeries,
      maPeriods: view.maPeriods,
      macd: view.macd,
      showMacdPanel: view.showMacdPanel,
    }),
    ctx,
  )
  assert.equal(sliced.n, DEFAULT_VIEW_BARS)
  assert.equal(sliced.xs[0], sliced.padL)
  assert.equal(sliced.xs[sliced.n - 1], sliced.padL + sliced.plotW)
  assert.equal(sliced.showMacd, true, '窗口只有 30 根也照常展示 MACD（按全量判定）')
  assert.ok(
    sliced.candleW > full.candleW * 3,
    `30 根蜡烛应明显变粗（${sliced.candleW} vs ${full.candleW}）`,
  )
  // 命中范围收敛到窗口内，不会越到窗口外
  assert.equal(hitTestIndex(sliced, sliced.padL), 0)
  assert.equal(hitTestIndex(sliced, sliced.padL + sliced.plotW), DEFAULT_VIEW_BARS - 1)
})

test('fitMaLegend：放得下带数值，放不下自动降级为只有周期名', () => {
  const ctx = fakeCtx()
  const wide = buildQuoteChartLayout(baseData(), ctx)
  const legendOf = (plotW: number, value: number) =>
    fitMaLegend(ctx, { periods: MA_PERIODS, padL: wide.padL, plotW, valueOf: () => value })
  // 替身 measureText 按字符数估算（与字号无关），因此只能验证「带数值 / 不带数值」这一级降级
  const fits = legendOf(wide.plotW, 123.45)
  assert.ok(
    fits.items.every((item) => item.text.includes(':')),
    '宽图例带数值',
  )
  assert.deepEqual(
    fits.items.map((item) => item.text.slice(0, 3)),
    ['MA5', 'MA2', 'MA3', 'MA6'],
  )
  assert.deepEqual(
    fits.items.map((item) => item.colorIndex),
    [0, 1, 2, 3],
    'colorIndex 与均线下标一一对应（配色由调用方决定）',
  )

  // 指数量级的长数值（如 12345.68）在同一宽度下放不下 → 只留周期名
  const long = legendOf(wide.plotW, 12345.678)
  assert.ok(
    long.items.every((item) => !item.text.includes(':')),
    '长数值放不下 → 只留周期名',
  )

  const narrow = legendOf(54, 123.45)
  assert.ok(
    narrow.items.every((item) => !item.text.includes(':')),
    '窄图例只剩周期名',
  )
  assert.deepEqual(
    narrow.items.map((item) => item.text),
    ['MA5', 'MA20', 'MA30', 'MA60'],
  )
})

test('dragViewport：按手指位移换算根数（整根吸附），左右都夹在首尾', () => {
  const total = 200
  const base = defaultViewport(total)
  assert.deepEqual(base, { viewBars: 30, viewEnd: 199 })
  const plotW = 290
  const pxPerBar = plotW / (30 - 1)
  // 手指右移 = 看更早的 K 线
  assert.equal(dragViewport(total, base, pxPerBar * 5, plotW).viewEnd, 194)
  assert.equal(dragViewport(total, base, -pxPerBar * 5, plotW).viewEnd, 199, '右移已在最新处，夹住')
  assert.equal(dragViewport(total, base, 0, plotW).viewEnd, 199, '微小抖动不产生位移')
  assert.equal(dragViewport(total, base, 99999, plotW).viewEnd, 29, '拖到历史起点即停')
  assert.equal(dragViewport(total, base, -99999, plotW).viewEnd, 199, '拖到最新一根即停')
  assert.equal(dragViewport(total, base, 0, 0).viewEnd, 199, 'plotW 非法时不位移')
})

test('pinchViewport：指距放大 → 根数变少、锚点那根停在原位，且受 [10, 全量] 限制', () => {
  const total = 200
  const base = defaultViewport(total) // 窗口 170~199
  const zoomed = pinchViewport(total, base, 2, 0.5)
  assert.equal(zoomed.viewBars, 15, '指距放大两倍 → 根数减半')
  const anchorBefore = 170 + 0.5 * 29
  const anchorAfter = zoomed.viewEnd - 15 + 1 + 0.5 * (15 - 1)
  assert.ok(
    Math.abs(anchorAfter - anchorBefore) <= 1,
    `锚点那根应基本停在原位：${anchorAfter} vs ${anchorBefore}`,
  )
  assert.equal(pinchViewport(total, base, 0.01, 0.5).viewBars, total, '捏合到极限 = 全量')
  assert.equal(pinchViewport(total, base, 100, 0.5).viewBars, MIN_VIEW_BARS, '撑开到极限 = 10 根')
  assert.deepEqual(pinchViewport(total, base, 1.01, 0.5), base, '死区内不动（防手指抖动）')
  assert.deepEqual(pinchViewport(total, base, Number.NaN, 0.5), base)
})

// ---------------------------------------------------------------------------
// 触摸命中
// ---------------------------------------------------------------------------

test('hitTestIndex：等分布局下按步长反算并夹紧到 [0, n-1]', () => {
  const ctx = fakeCtx()
  const layout = buildQuoteChartLayout(baseData(), ctx)
  assert.equal(hitTestIndex(layout, layout.padL), 0)
  assert.equal(hitTestIndex(layout, layout.padL + layout.plotW), layout.n - 1)
  const mid = layout.padL + layout.plotW / 2
  const midIndex = hitTestIndex(layout, mid)
  assert.ok(midIndex !== null && Math.abs(midIndex - (layout.n - 1) / 2) <= 1)
  assert.equal(hitTestIndex(layout, -999), 0, '左侧越界夹紧到 0')
  assert.equal(hitTestIndex(layout, 99999), layout.n - 1, '右侧越界夹紧到 n-1')
})

test('hitTestIndex：时段铺点下命中最近的真实数据点（未来留白区不越界）', () => {
  const ctx = fakeCtx()
  const points: MinutePoint[] = []
  for (let i = 0; i < 30; i += 1) {
    points.push(minutePoint(`09:${String(30 + i)}`, 10, `2026-09-14 09:${String(30 + i)}`))
  }
  const layout = buildQuoteChartLayout(
    baseData({ mode: 'minute', points, preClose: 10, session: 'ashare' }),
    ctx,
  )
  const farRight = hitTestIndex(layout, layout.padL + layout.plotW)
  assert.equal(farRight, points.length - 1, '点在时间轴最右（未来留白）时命中最后一个数据点')
})

test('hitTestIndex：数据不足（n < 2）返回 null，调用方不画十字光标', () => {
  const ctx = fakeCtx()
  const layout = buildQuoteChartLayout(baseData({ klines: [] }), ctx)
  assert.equal(hitTestIndex(layout, 100), null)
})

// ---------------------------------------------------------------------------
// 五日分日切分纯函数
// ---------------------------------------------------------------------------

test('splitMinuteDays：按 timeFull 的自然日切段，返回每段的起止下标', () => {
  const points = [
    minutePoint('09:30', 10, '2026-09-11 09:30'),
    minutePoint('09:31', 10, '2026-09-11 09:31'),
    minutePoint('09:30', 11, '2026-09-14 09:30'),
  ]
  const days = splitMinuteDays(points)
  assert.deepEqual(days, [
    { date: '2026-09-11', start: 0, end: 1 },
    { date: '2026-09-14', start: 2, end: 2 },
  ])
})

test('splitMinuteDays：无日期信息返回空数组（调用方退化为不分段绘制）', () => {
  assert.deepEqual(splitMinuteDays([minutePoint('09:30', 10)]), [])
  assert.deepEqual(splitMinuteDays([]), [])
  assert.equal(minutePointDate(minutePoint('09:30', 10)), null)
  assert.equal(minutePointDate(minutePoint('2026-09-14 09:30', 10)), '2026-09-14')
})

test('minuteDayLabel：日期取 MM-DD；非日期原样返回', () => {
  assert.equal(minuteDayLabel('2026-09-09'), '09-09')
  assert.equal(minuteDayLabel('bad'), 'bad')
})

// ---------------------------------------------------------------------------
// 边界：极端取值不应产生 NaN 坐标 / 除零
// ---------------------------------------------------------------------------

test('布局健壮性：数据为 0 价 / 极值 / 平盘时纵轴仍是有限合法区间', () => {
  const ctx = fakeCtx()
  const flat = buildQuoteChartLayout(
    baseData({ klines: Array.from({ length: 50 }, () => kline('2026-01-01', 10)) }),
    ctx,
  )
  assert.ok(Number.isFinite(flat.minP) && Number.isFinite(flat.maxP))
  assert.ok(flat.maxP > flat.minP)
  const zeroPriceMinute = buildQuoteChartLayout(
    baseData({
      mode: 'minute',
      points: [minutePoint('09:30', 0), minutePoint('09:31', 0)],
      preClose: 0,
    }),
    ctx,
  )
  assert.ok(Number.isFinite(zeroPriceMinute.minP) && Number.isFinite(zeroPriceMinute.maxP))
  assert.ok(zeroPriceMinute.maxP > zeroPriceMinute.minP)
  const empty = buildQuoteChartLayout(baseData({ klines: [] }), ctx)
  assert.equal(empty.n, 0)
  assert.ok(empty.xs.length === 0)
})
