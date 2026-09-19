import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildQuoteChartLayout,
  hitTestIndex,
  isKlineMode,
  klinePeriodOf,
  layoutPriceY,
  MA_PERIODS,
  renderChart,
  renderCrosshair,
  type ChartCtx,
  type QuoteChartData,
} from '../packageQuote/components/quote-chart/draw.ts'
import {
  buildKlineView,
  clampViewport,
  DEFAULT_VIEW_BARS,
  defaultViewport,
  MIN_VIEW_BARS,
  panRepeatStep,
  panViewport,
  scaleViewport,
  zoomViewport,
} from '../utils/kline-viewport.ts'
import { fitMaLegend } from '../utils/kline-legend.ts'
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

test('isKlineMode / klinePeriodOf：只有日周月年走 K 线，分时走分时链路', () => {
  assert.equal(isKlineMode('minute'), false)
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
  assert.equal(layout.maSeries.length, 5, 'MA5 / MA10 / MA20 / MA30 / MA60 五条')
  assert.deepEqual(layout.maPeriods, [5, 10, 20, 30, 60])
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
  assert.equal(withoutMacd.macdTop, withoutMacd.volTop + withoutMacd.volH + 22)
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
  assert.equal(view.maSeries.length, 5)
  for (const series of view.maSeries) assert.equal(series.length, view.klines.length)
  const ma60 = view.maSeries[view.maPeriods.indexOf(60)] ?? []
  assert.ok(
    ma60.every((v) => v !== null),
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
  const ma60AtStart = view.maSeries[view.maPeriods.indexOf(60)] ?? []
  assert.ok(
    ma60AtStart.every((v) => v === null),
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

test('zoomViewport：缩放夹在 [10, 全量]，右端锚定；窗口宽度不因平移变化', () => {
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
  assert.equal(pan.viewEnd, 198, '左移一次 = 1 根 K 线')
  assert.equal(pan.viewBars, 30, '平移不改变窗口宽度')
  for (let i = 0; i < 200; i += 1) pan = panViewport(total, pan, 'left')
  assert.equal(pan.viewEnd, 29, '贴到历史起点（窗口 0~29）')
  for (let i = 0; i < 200; i += 1) pan = panViewport(total, pan, 'right')
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
  // 替身 measureText 按字符数估算（与字号无关），因此只能验证「完整数值 / 缩写数值 / 不带数值」
  // 这三档；字号档（10px → 9px）在替身上量不出差别，这里靠放宽绘图区宽度来验证第一档。
  const fits = legendOf(wide.plotW + 80, 123.45)
  assert.ok(
    fits.items.every((item) => item.text.includes(':')),
    '宽图例带数值',
  )
  assert.deepEqual(
    fits.items.map((item) => item.text.slice(0, 3)),
    ['MA5', 'MA1', 'MA2', 'MA3', 'MA6'],
  )
  assert.deepEqual(
    fits.items.map((item) => item.colorIndex),
    [0, 1, 2, 3, 4],
    'colorIndex 与均线下标一一对应（配色由调用方决定）',
  )

  // 指数量级的长数值（如 12345.68）：完整两位小数整行 332px、缩写档 277px（替身按 5px/字符），
  // 取 294px 正好卡在两档之间 → 降级为缩写（≥1000 取整），仍看得到均线数值
  const long = legendOf(wide.plotW + 20, 12345.678)
  assert.deepEqual(
    long.items.map((item) => item.text),
    ['MA5:12346', 'MA10:12346', 'MA20:12346', 'MA30:12346', 'MA60:12346'],
  )
  // 三位数价格（如 123.456）的缩写档留 1 位小数
  assert.deepEqual(
    legendOf(wide.plotW + 20, 123.456).items.map((item) => item.text),
    ['MA5:123.5', 'MA10:123.5', 'MA20:123.5', 'MA30:123.5', 'MA60:123.5'],
    '三位数缩写为 1 位小数',
  )

  const narrow = legendOf(54, 123.45)
  assert.ok(
    narrow.items.every((item) => !item.text.includes(':')),
    '连缩写都放不下 → 只剩周期名',
  )
  assert.deepEqual(
    narrow.items.map((item) => item.text),
    ['MA5', 'MA10', 'MA20', 'MA30', 'MA60'],
  )
})

test('panViewport：每次移动 1 根（默认），首尾夹紧；长按连发步长逐步加速', () => {
  const total = 200
  const base = defaultViewport(total)
  assert.deepEqual(base, { viewBars: 30, viewEnd: 199 })
  assert.equal(panViewport(total, base, 'left').viewEnd, 198, '左移一次 = 1 根')
  assert.equal(panViewport(total, base, 'right').viewEnd, 199, '已在最新一根 → 夹住')
  assert.equal(panViewport(total, base, 'left', 25).viewEnd, 174, '可指定移动根数（连发用）')
  assert.equal(panViewport(total, base, 'left', 9999).viewEnd, 29, '移到历史起点即停')
  assert.equal(panViewport(total, base, 'left', 0).viewEnd, 198, '非法根数按 1 根处理')

  // 长按连发：起步 1 根/次，每 10 次（约 0.8s）加 1 根，快速按住即可翻长历史
  assert.equal(panRepeatStep(0), 1)
  assert.equal(panRepeatStep(9), 1)
  assert.equal(panRepeatStep(10), 2)
  assert.equal(panRepeatStep(25), 3)
  assert.equal(panRepeatStep(Number.NaN), 1)
})

test('scaleViewport：指距缩放只改根数、最右侧那根始终不动，且受 [10, 全量] 限制', () => {
  const total = 200
  const base = defaultViewport(total) // 窗口 170~199
  const zoomed = scaleViewport(total, base, 2)
  assert.equal(zoomed.viewBars, 15, '指距放大两倍 → 根数减半')
  assert.equal(zoomed.viewEnd, base.viewEnd, '锚点 = 最右侧那根，缩放前后不动')
  assert.deepEqual(scaleViewport(total, base, 0.5), clampViewport(total, 60, base.viewEnd))

  // 已翻到历史（窗口右端不是最新一根）时同样以窗口最右侧为基准，锚点不因两指落点漂移
  const panned = { viewBars: DEFAULT_VIEW_BARS, viewEnd: 120 }
  assert.equal(scaleViewport(total, panned, 2).viewEnd, 120)
  assert.equal(scaleViewport(total, panned, 0.5).viewEnd, 120)

  assert.equal(scaleViewport(total, base, 0.01).viewBars, total, '捏合到极限 = 全量')
  assert.equal(scaleViewport(total, base, 100).viewBars, MIN_VIEW_BARS, '撑开到极限 = 10 根')
  assert.deepEqual(scaleViewport(total, base, 1.01), base, '死区内不动（防手指抖动）')
  assert.deepEqual(scaleViewport(total, base, Number.NaN), base)
  assert.deepEqual(scaleViewport(total, base, 0), base, '非法指距按不动处理')
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

// ---------------------------------------------------------------------------
// 极值标注：K 线标出区间最高 / 最低价（箭头 + 价格），分时不标；不再常驻最新价标签
// ---------------------------------------------------------------------------

/** 记录 fillText / 填充三角形 / 圆点的 canvas 替身：断言图上写了哪些文字、箭头与圆点画在哪 */
function recordingCtx(): ChartCtx & {
  drawn: Array<{ text: string; x: number; y: number }>
  polys: Array<{ points: Array<{ x: number; y: number }>; fillStyle: string }>
  arcs: Array<{ x: number; y: number; r: number }>
} {
  const drawn: Array<{ text: string; x: number; y: number }> = []
  const polys: Array<{ points: Array<{ x: number; y: number }>; fillStyle: string }> = []
  const arcs: Array<{ x: number; y: number; r: number }> = []
  let current: Array<{ x: number; y: number }> = []
  const ctx = {
    ...fakeCtx(),
    drawn,
    polys,
    arcs,
    beginPath: () => {
      current = []
    },
    moveTo: (x: number, y: number) => {
      current.push({ x, y })
    },
    lineTo: (x: number, y: number) => {
      current.push({ x, y })
    },
    arc: (x: number, y: number, r: number) => {
      arcs.push({ x, y, r })
    },
    fill: () => {
      if (current.length) polys.push({ points: [...current], fillStyle: String(ctx.fillStyle) })
    },
    fillText: (text: string, x: number, y: number) => {
      drawn.push({ text, x, y })
    },
  }
  return ctx
}

/** 取填充色为 color 的三角形（极值标注的箭头）：返回尖端 / 底边两端 */
function arrowOf(
  ctx: ReturnType<typeof recordingCtx>,
  color: string,
): { apex: { x: number; y: number }; base: Array<{ x: number; y: number }> } | null {
  const tri = ctx.polys.find((poly) => poly.fillStyle === color && poly.points.length === 3)
  if (!tri) return null
  const sorted = [...tri.points].sort((a, b) => a.x - b.x)
  // 尖端是横向最靠内（独一份 x）的那个顶点：三点里 x 相同的两个是底边
  const apex = sorted[1]!.x === sorted[0]!.x ? sorted[2]! : sorted[0]!
  return { apex, base: tri.points.filter((point) => point !== apex) }
}

test('K 线渲染：区间最高 / 最低价各标一个（箭头指向极值点 + 价格文字），且不再常驻最新价', () => {
  const klines = Array.from({ length: 30 }, (_, i) => kline('2026-01-01', 30 + i * 0.1))
  // 第 5 根同时是区间最高（88.88）与最低（11.11），两个标注都贴在它旁边
  klines[5] = { time: '2026-01-06', open: 50, close: 50, high: 88.88, low: 11.11, volume: 1000 }
  const data = baseData({ klines })
  const ctx = recordingCtx()
  const layout = buildQuoteChartLayout(data, ctx)
  renderChart(ctx, data, layout)

  const hi = ctx.drawn.find((item) => item.text === '88.88')
  const lo = ctx.drawn.find((item) => item.text === '11.11')
  assert.ok(hi, `应标出最高价 88.88：${ctx.drawn.map((item) => item.text).join(' ')}`)
  assert.ok(lo, '应标出最低价 11.11')
  const x = layout.xs[5] ?? 0
  const hiY = layoutPriceY(layout, 88.88)
  const loY = layoutPriceY(layout, 11.11)
  // 文字基线比极值点低 3.5px（10px 字号的垂直居中），即视觉上与极值点同一水平
  assert.ok(Math.abs(hi.y - (hiY + 3.5)) < 1e-9, '最高价文字与最高点同一水平')
  assert.ok(Math.abs(lo.y - (loY + 3.5)) < 1e-9, '最低价文字与最低点同一水平')
  // 极值在窗口左端 → 标签摆右侧，箭头尖端（红）反向指回最高点
  assert.ok(hi.x > x && hi.x - x <= 12, `最高价文字贴在最高点右侧（${hi.x} vs ${x}）`)
  const hiArrow = arrowOf(ctx, '#eb514d')
  assert.ok(hiArrow, '最高价旁应画红色箭头三角')
  assert.ok(Math.abs(hiArrow.apex.x - (x + 2)) < 1e-9, '箭头尖端朝左指向最高点')
  assert.ok(Math.abs(hiArrow.apex.y - hiY) < 1e-9, '箭头与最高点同一高度')
  const loArrow = arrowOf(ctx, '#20a66a')
  assert.ok(loArrow, '最低价旁应画绿色箭头三角')
  assert.ok(Math.abs(loArrow.apex.y - loY) < 1e-9, '箭头与最低点同一高度')

  const lastClose = (klines[klines.length - 1] as KlinePoint).close.toFixed(2)
  assert.ok(
    !ctx.drawn.some((item) => item.text === lastClose),
    `不应再常驻最新价标签（${lastClose}）`,
  )
})

test('分时渲染：不标区间极值（读数交给十字光标触摸查看），但仍保留 0% 基准刻度', () => {
  const points = [
    minutePoint('09:30', 11),
    minutePoint('09:31', 12.34),
    minutePoint('09:32', 9.87),
    minutePoint('09:33', 11.2),
  ]
  const data = baseData({ mode: 'minute', points, preClose: 11, session: 'continuous' })
  const ctx = recordingCtx()
  const layout = buildQuoteChartLayout(data, ctx)
  renderChart(ctx, data, layout)
  const texts = ctx.drawn.map((item) => item.text)
  assert.ok(!texts.includes('12.34'), `分时不标最高价：${texts.join(' ')}`)
  assert.ok(!texts.includes('9.87'), '分时不标最低价')
  assert.ok(texts.includes('0%'), '分时仍保留 0% 基准刻度')
})

test('十字光标：K 线不在交点画实心圆点，分时保留圆点', () => {
  // K 线（日/周/月/年共用同一套绘制）：蜡烛已标出收盘位置，交点再叠圆点只是噪声
  const klines = Array.from({ length: 30 }, (_, i) => kline('2026-01-01', 10 + i * 0.1))
  const klineData = baseData({ klines, activeIndex: 3 })
  const klineCtx = recordingCtx()
  renderCrosshair(klineCtx, klineData, buildQuoteChartLayout(klineData, klineCtx))
  assert.equal(klineCtx.arcs.length, 0, 'K 线十字光标不画交点圆点')
  assert.ok(
    klineCtx.drawn.some((item) => item.text.startsWith('收 ')),
    '信息框照常给出该根读数',
  )

  // 分时：走势线上没有蜡烛，圆点用来定位当前读数 → 保留（价格点 + 均价点）
  const points = [minutePoint('09:30', 10), minutePoint('09:31', 10.2), minutePoint('09:32', 9.9)]
  const minuteData = baseData({ mode: 'minute', points, preClose: 10, activeIndex: 1 })
  const minuteCtx = recordingCtx()
  renderCrosshair(minuteCtx, minuteData, buildQuoteChartLayout(minuteData, minuteCtx))
  assert.ok(
    minuteCtx.arcs.some((arc) => arc.r === 3.5),
    '分时十字光标仍画价格圆点',
  )
})
