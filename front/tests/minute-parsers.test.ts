import assert from 'node:assert/strict'
import test from 'node:test'

import {
  MIN_MINUTE_POINTS,
  buildCompositePoints,
  buildCrossPoints,
  fullTimeOf,
  parseEastmoneyTrends,
  parseTencentMinuteNode,
  parseYahooMinuteResult,
  shortTime,
} from '../utils/minute-parser.ts'
import { MINUTE_SOURCES, US_PROXY_NAMES, hasMinuteSources } from '../config/minute.ts'
import {
  computeMinuteVolumeDirections,
  mergeMinuteQuoteInfo,
  sparseVolumeNote,
} from '../utils/minute.ts'
import type { EastmoneyUlistQuote } from '../types/quote.ts'
import {
  ASIA_INDICES,
  ASIA_JP_STOCKS,
  ASIA_KR_STOCKS,
  ASIA_RATES,
  AVG_PRICE_CONFIG,
  GLOBAL_INDICES,
  INDUSTRY_BOARDS,
  MACRO_ASSETS,
  METALS,
} from '../config/tabbar.ts'

// ---------------------------------------------------------------------------
// 东财分时（trends2）
// 生产请求 fields2=f51,f53,f56,f58，每行 [0]时间 [1]现价 [2]成交量 [3]均价；
// 全字段版（f51..f58）行结构为 [时间,开盘,现价,最高,最低,成交量,成交额,均价]，
// 现价在 f[2] 而非 f[1]（f[1] 是开盘价）——解析器按字段数自适应，现价一律取 f53。
// ---------------------------------------------------------------------------

test('东财：4字段行解析为 MinutePoint，昨收透传，现价取 f53 位置', () => {
  const data = {
    preClose: 3990.3,
    trends: [
      '2026-08-19 09:30,3952.12,5649180,3951.819',
      '2026-08-19 09:31,3955.56,15142187,3951.438',
    ],
  }
  const result = parseEastmoneyTrends(data)
  assert.ok(result)
  assert.equal(result!.preClose, 3990.3)
  assert.equal(result!.points.length, 2)
  assert.deepEqual(result!.points[0]!, {
    time: '09:30',
    timeFull: '2026-08-19 09:30',
    price: 3952.12,
    avg: 3951.819,
    volume: 5649180,
    amount: undefined,
  })
  // 第二分钟现价 = 行 f[1]（f53），不是开盘价（全字段版 f[1] 为开盘，实测可差数百点）
  assert.deepEqual(result!.points[1]!, {
    time: '09:31',
    timeFull: '2026-08-19 09:31',
    price: 3955.56,
    avg: 3951.438,
    volume: 15142187,
    amount: undefined,
  })
})

test('东财：8字段行（兼容/兜底）现价取 f[2]，不再误读 f[1] 开盘价', () => {
  const data = {
    preClose: 52759.21,
    trends: [
      '2026-08-21 21:30,52768.87,52768.87,52768.87,52768.87,0,0.00,52768.870',
      '2026-08-21 21:31,52768.87,53026.14,53047.33,53026.14,43897382,0.00,52897.505',
    ],
  }
  const result = parseEastmoneyTrends(data)
  assert.ok(result)
  assert.equal(result!.points[0]!.price, 52768.87)
  // 现价应取 f[2]=53026.14（f[1]=52768.87 是该分钟开盘价，与上一分钟收盘相同）
  assert.equal(result!.points[1]!.price, 53026.14)
  assert.equal(result!.points[1]!.volume, 43897382)
  assert.equal(result!.points[1]!.amount, 0)
  assert.equal(result!.points[1]!.avg, 52897.505)
})

test('东财：空数据 / 非法行 / 点数不足返回 null', () => {
  assert.equal(parseEastmoneyTrends(undefined), null)
  assert.equal(parseEastmoneyTrends({ preClose: 1, trends: [] }), null)
  assert.equal(
    parseEastmoneyTrends({ preClose: 1, trends: ['bad-row'] }),
    null,
    '非法行被跳过后点数不足',
  )
})

test('东财：外汇均价 0（无成交量）→ null；0 价 / 空价格行跳过，避免撑爆纵轴', () => {
  // 外汇 24h 分钟量恒为 0，东财均价字段返回 0.00000；若按 0 参与纵轴计算，
  // |0-昨收| 会把刻度对称撑到 [-1.88, 48.87]（实测复现），必须置 null
  const data = {
    preClose: 23.4957,
    trends: [
      // 正常行（成交量 0、均价 0）
      '2026-08-20 05:00,23.4957,0,0.00000',
      // 0 价行（无成交分钟）应跳过
      '2026-08-20 05:01,0,0,0.00000',
      // 空价格字段（Number('')=0）应跳过
      '2026-08-20 05:02,,0,0.00000',
      // 正常行
      '2026-08-20 05:03,23.52,0,0.00000',
    ],
  }
  const result = parseEastmoneyTrends(data)
  assert.ok(result)
  assert.equal(result!.points.length, 2, '0 价/空价行被跳过')
  assert.equal(result!.points[0]!.price, 23.4957)
  assert.equal(result!.points[0]!.avg, null, '均价 0 → null（避免纵轴被撑爆）')
  assert.equal(result!.points[1]!.price, 23.52)
  assert.equal(result!.points[1]!.avg, null)
})

test('东财：昨结算透传（期货口径），非期货为 0/缺失 → null', () => {
  // 沪银主连 113.agm 实测：preSettlement=16611（昨结算）、preClose=16771（昨收）
  const futures = {
    preClose: 16771,
    preSettlement: 16611,
    trends: ['2026-08-21 21:00,16896,0,0.0', '2026-08-21 21:01,16968,200,16910.0'],
  }
  const result = parseEastmoneyTrends(futures)
  assert.ok(result)
  assert.equal(result!.preClose, 16771, '昨收原样透传（展示用）')
  assert.equal(result!.preSettlement, 16611, '昨结算透传（涨跌幅基准）')
  // A股指数实测 preSettlement=0 → null（等同非期货）
  const index = parseEastmoneyTrends({
    preClose: 3903.72,
    preSettlement: 0,
    trends: ['2026-08-22 09:30,3900.1,100,3899.9', '2026-08-22 09:31,3901.2,200,3900.5'],
  })
  assert.ok(index)
  assert.equal(index!.preSettlement, null, 'preSettlement=0 视为缺失')
  // 缺失 preSettlement 字段 → null
  const stock = parseEastmoneyTrends({
    preClose: 98,
    trends: ['2026-08-22 09:30,97.5,100,97.4', '2026-08-22 09:31,97.8,200,97.6'],
  })
  assert.ok(stock)
  assert.equal(stock!.preSettlement, null)
})

test('东财：keepFullTime 保留完整时间戳，name 透传证券中文名', () => {
  const data = {
    preClose: 219.74,
    name: '英伟达',
    trends: [
      '2026-08-19 21:30,222.070,2801010,220.8105',
      '2026-08-20 00:00,219.321,124395,219.2459',
    ],
  }
  // 默认短时间
  const normal = parseEastmoneyTrends(data)
  assert.ok(normal)
  assert.equal(normal!.name, '英伟达')
  assert.equal(normal!.points[0]!.time, '21:30')
  assert.equal(normal!.points[1]!.time, '00:00')
  // timeFull 始终保留完整时间戳（触摸浮层展示「年月日 时分」，跨零点逐点准确）
  assert.equal(normal!.points[0]!.timeFull, '2026-08-19 21:30')
  assert.equal(normal!.points[1]!.timeFull, '2026-08-20 00:00')
  // keepFullTime：保留完整时间戳（字典序即时间序，跨零点不重排）
  const full = parseEastmoneyTrends(data, { keepFullTime: true })
  assert.ok(full)
  assert.equal(full!.points[0]!.time, '2026-08-19 21:30')
  assert.equal(full!.points[1]!.time, '2026-08-20 00:00')
  assert.equal(full!.points[0]!.timeFull, '2026-08-19 21:30')
  assert.equal(full!.points[1]!.timeFull, '2026-08-20 00:00')
})

// ---------------------------------------------------------------------------
// 美股代理股分时均值合成（buildCompositePoints）
// ---------------------------------------------------------------------------

test('合成：多只代理股按完整时间戳对齐取均值，跨零点顺序正确', () => {
  const points = buildCompositePoints([
    {
      name: '英伟达',
      points: [
        { time: '2026-08-19 21:30', norm: 100.5, volume: 100 },
        { time: '2026-08-19 21:31', norm: 101, volume: 200 },
        { time: '2026-08-20 00:00', norm: 102, volume: 300 },
      ],
    },
    {
      name: '超威半导体',
      points: [
        { time: '2026-08-19 21:30', norm: 99.5, volume: 50 },
        { time: '2026-08-19 21:31', norm: 99, volume: 60 },
        // 该代理缺 00:00 分钟（个别股票缺数据），合成时跳过
      ],
    },
  ])
  assert.equal(points.length, 3)
  assert.equal(points[0]!.time, '21:30')
  assert.equal(points[0]!.timeFull, '2026-08-19 21:30', '合成保留完整时间戳（触摸浮层用）')
  assert.equal(points[0]!.price, 100, '(100.5+99.5)/2')
  assert.equal(points[0]!.volume, 150, '成交量取代理之和')
  assert.equal(points[1]!.time, '21:31')
  assert.equal(points[1]!.timeFull, '2026-08-19 21:31')
  assert.equal(points[1]!.price, 100, '(101+99)/2')
  assert.equal(points[2]!.time, '00:00', '跨零点 00:00 排在 21:31 之后')
  assert.equal(points[2]!.timeFull, '2026-08-20 00:00', '跨零点后日期为次日')
  assert.equal(points[2]!.price, 102, '仅一只代理有数据时取该值')
  assert.equal(points[2]!.volume, 300)
  assert.equal(points[0]!.avg, null, '合成序列无均价')
})

test('合成：无任何序列返回空数组', () => {
  assert.deepEqual(buildCompositePoints([]), [])
})

// ---------------------------------------------------------------------------
// 交叉汇率合成（buildCrossPoints）：人民币/韩元 = 美元/韩元 ÷ 美元/离岸人民币
// ---------------------------------------------------------------------------

test('交叉汇率：分子÷分母逐分钟相除，分母缺分钟跳过，输出 HH:mm 且无成交量', () => {
  const points = buildCrossPoints(
    {
      points: [
        { time: '2026-08-20 05:00', price: 1388.7175 },
        { time: '2026-08-20 05:01', price: 1389.46 },
        { time: '2026-08-20 05:02', price: 1389.5225 },
      ],
    },
    {
      points: [
        { time: '2026-08-20 05:00', price: 6.7306 },
        // 05:01 缺分钟（应跳过）
        { time: '2026-08-20 05:02', price: 6.7312 },
      ],
    },
  )
  assert.equal(points.length, 2)
  assert.equal(points[0]!.time, '05:00')
  assert.equal(points[0]!.timeFull, '2026-08-20 05:00', '交叉合成保留完整时间戳')
  assert.equal(points[0]!.price, Math.round((1388.7175 / 6.7306) * 10000) / 10000, '分子÷分母')
  assert.equal(points[1]!.time, '05:02')
  assert.equal(points[1]!.timeFull, '2026-08-20 05:02')
  assert.equal(points[1]!.volume, 0, '合成序列无成交量')
  assert.equal(points[1]!.avg, null, '合成序列无均价')
})

test('交叉汇率：任一腿为空返回空数组，分母为 0 跳过', () => {
  assert.deepEqual(buildCrossPoints({ points: [] }, { points: [{ time: 't', price: 1 }] }), [])
  assert.deepEqual(buildCrossPoints({ points: [{ time: 't', price: 1 }] }, { points: [] }), [])
  assert.deepEqual(
    buildCrossPoints({ points: [{ time: 't', price: 1 }] }, { points: [{ time: 't', price: 0 }] }),
    [],
    '分母为 0 跳过',
  )
})

// ---------------------------------------------------------------------------
// 腾讯分时（minute/query）
// 每行 ["0930","现价","成交量","成交额"]；均价=累计成交额/累计成交量；昨收=qt.<code>[4]
// ---------------------------------------------------------------------------

test('腾讯：行解析 + 均价按累计成交额/成交量推算 + 昨收取 qt 数组[4]', () => {
  const node = {
    data: {
      data: [
        ['0930', '56.20', '5847', '32860140.00'],
        ['0931', '56.60', '20571', '115813645.00'],
      ],
    },
    qt: { v_ff_sh600549: [], sh600549: ['1', '厦门钨业', '600549', '56.20', '58.11'] },
  }
  const result = parseTencentMinuteNode(node)
  assert.ok(result)
  assert.equal(result!.preClose, 58.11)
  assert.equal(result!.points.length, 2)
  assert.equal(result!.points[0]!.time, '09:30')
  // 腾讯行只有 "HHmm" 无日期信息 → timeFull 缺省（触摸浮层回退展示 HH:mm）
  assert.equal(result!.points[0]!.timeFull, undefined)
  assert.equal(result!.points[0]!.price, 56.2)
  // 均价 = 32860140 / 5847
  assert.ok(Math.abs(result!.points[0]!.avg! - 32860140 / 5847) < 0.001)
  // 第二点累计量：5847+20571，累计额：32860140+115813645
  const cumVol = 5847 + 20571
  const cumAmt = 32860140 + 115813645
  assert.ok(Math.abs(result!.points[1]!.avg! - cumAmt / cumVol) < 0.001)
})

test('腾讯：无 qt 时昨收为 null；点数不足返回 null', () => {
  const node = {
    data: { data: [['0930', '56.20', '5847', '32860140.00']] },
    qt: {},
  }
  const single = parseTencentMinuteNode(node)
  assert.equal(single, null, '1 个点少于 MIN_MINUTE_POINTS')
  const two = parseTencentMinuteNode({
    data: {
      data: [
        ['0930', '56.20', '5847', '32860140.00'],
        ['0931', '56.60', '20571', '115813645.00'],
      ],
    },
    qt: {},
  })
  assert.ok(two)
  assert.equal(two!.preClose, null)
})

// ---------------------------------------------------------------------------
// Yahoo 1分钟（chart v8）
// ---------------------------------------------------------------------------

test('Yahoo：timestamp + close 解析，昨收取 chartPreviousClose，均价按价×量累计推算', () => {
  // 本地时区 2026-08-19 09:30 ~ 09:31（epoch 秒按本地时间构造）
  const base = new Date(2026, 7, 19, 9, 30).getTime() / 1000
  const result = {
    meta: { chartPreviousClose: 58.11 },
    timestamp: [base, base + 60],
    indicators: {
      quote: [
        {
          open: [56.2, 56.5],
          high: [56.3, 56.8],
          low: [56.1, 56.4],
          close: [56.2, 56.6],
          volume: [5847, 20571],
        },
      ],
    },
  }
  const parsed = parseYahooMinuteResult(result)
  assert.ok(parsed)
  assert.equal(parsed!.preClose, 58.11)
  assert.equal(parsed!.points.length, 2)
  assert.equal(parsed!.points[0]!.time, '09:30')
  assert.equal(parsed!.points[0]!.timeFull, '2026-08-19 09:30', 'Yahoo epoch 转本地完整时间戳')
  assert.equal(parsed!.points[0]!.price, 56.2)
  const cumAmt = 56.2 * 5847 + 56.6 * 20571
  const cumVol = 5847 + 20571
  assert.ok(Math.abs(parsed!.points[1]!.avg! - cumAmt / cumVol) < 0.001)
})

test('Yahoo：close 为 null 的行跳过；点数不足 / 空 result 返回 null', () => {
  assert.equal(parseYahooMinuteResult(undefined), null)
  const base = new Date(2026, 7, 19, 9, 30).getTime() / 1000
  const one = parseYahooMinuteResult({
    meta: {},
    timestamp: [base],
    indicators: { quote: [{ close: [56.2], volume: [100] }] },
  })
  assert.equal(one, null, '1 个点少于 MIN_MINUTE_POINTS')
  const withNull = parseYahooMinuteResult({
    meta: {},
    timestamp: [base, base + 60, base + 120],
    indicators: { quote: [{ close: [null, 56.6, 56.7], volume: [null, 20571, 3000] }] },
  })
  assert.ok(withNull)
  assert.equal(withNull!.points.length, 2)
})

// ---------------------------------------------------------------------------
// 时间显示统一
// ---------------------------------------------------------------------------

test('shortTime：ISO / 带秒 / 腾讯 HHmm 统一为 HH:mm', () => {
  assert.equal(shortTime('2026-08-19 09:30'), '09:30')
  assert.equal(shortTime('2026-08-19 09:30:00'), '09:30')
  assert.equal(shortTime('2026-08-19T09:30:00'), '09:30')
  assert.equal(shortTime('0930'), '09:30')
  assert.equal(shortTime('21:00'), '21:00')
  assert.equal(shortTime(''), '')
})

test('fullTimeOf：ISO 完整时间戳归一化为 YYYY-MM-DD HH:mm，无日期信息返回 undefined', () => {
  assert.equal(fullTimeOf('2026-08-19 09:30'), '2026-08-19 09:30')
  assert.equal(fullTimeOf('2026-08-19 09:30:00'), '2026-08-19 09:30')
  assert.equal(fullTimeOf('2026-08-19T09:30:00'), '2026-08-19 09:30')
  // 腾讯 "HHmm" / 空串 / 无法解析的串无日期信息
  assert.equal(fullTimeOf('0930'), undefined)
  assert.equal(fullTimeOf(''), undefined)
  assert.equal(fullTimeOf('09:30'), undefined)
})

test('sparseVolumeNote：东财韩/日市场分钟量稀疏时给出口径提示', () => {
  const sparse = Array.from({ length: 10 }, (_, i) => ({
    time: `${String(i).padStart(2, '0')}:00`,
    price: 100,
    volume: i % 2 === 0 ? 0 : 100,
    avg: 100,
  }))
  const note = sparseVolumeNote(sparse, 'em', 'kr')
  assert.ok(note && note.includes('东财'), '韩股东财源、半数分钟无量应提示')
  assert.equal(sparseVolumeNote(sparse, 'em', 'jp-yahoo'), note, '日股东财源同样提示')

  // 有量分钟 ≥80% 不提示（如 KS11 实测仅 3% 分钟为 0）
  const dense = Array.from({ length: 10 }, () => ({
    time: '09:00',
    price: 100,
    volume: 100,
    avg: 100,
  }))
  assert.equal(sparseVolumeNote(dense, 'em', 'kr'), '')
  // 非东财源（Yahoo 逐分钟聚合）不提示
  assert.equal(sparseVolumeNote(sparse, 'yahoo', 'kr'), '')
  // 非韩/日市场不提示
  assert.equal(sparseVolumeNote(sparse, 'em', 'ashare'), '')
  // 空数据不提示
  assert.equal(sparseVolumeNote([], 'em', 'kr'), '')
})

// ---------------------------------------------------------------------------
// 基础信息合并（mergeMinuteQuoteInfo）：东财 ulist 报价优先，缺字段回退分时推算
// ---------------------------------------------------------------------------

const quoteFixture = (overrides: Partial<EastmoneyUlistQuote> = {}): EastmoneyUlistQuote => ({
  secid: '100.DJIA',
  code: 'DJIA',
  market: '100',
  name: '道琼斯',
  price: 102,
  changePercent: null,
  open: 99.5,
  high: 103,
  low: 99,
  previousClose: 98.2,
  volume: 500,
  amount: null,
  ...overrides,
})

test('基础信息合并：无报价时全部回退分时推算', () => {
  const points = [
    { time: '09:30', price: 100, avg: 99, volume: 100 },
    { time: '09:31', price: 102, avg: 101, volume: 200 },
  ]
  assert.deepEqual(mergeMinuteQuoteInfo(points, { preClose: 98 }, null), {
    open: 100,
    high: 102,
    low: 100,
    preClose: 98,
    preCloseLabel: '昨收',
    volume: 300,
    hasVolume: true,
  })
})

test('基础信息合并：报价字段优先（今开/最高/最低/昨收/成交量）', () => {
  const points = [
    { time: '09:30', price: 100, avg: 99, volume: 100 },
    { time: '09:31', price: 102, avg: 101, volume: 200 },
  ]
  assert.deepEqual(mergeMinuteQuoteInfo(points, { preClose: 98 }, quoteFixture()), {
    open: 99.5,
    high: 103,
    low: 99,
    preClose: 98.2,
    preCloseLabel: '昨收',
    volume: 500,
    hasVolume: true,
  })
})

test('基础信息合并：报价字段为 0/空 时回退分时推算（外汇等无成交量标的）', () => {
  const points = [
    { time: '05:00', price: 1394.1, avg: null, volume: 0 },
    { time: '05:01', price: 1394.2, avg: null, volume: 0 },
  ]
  // 外汇：报价 f5=0、分钟量也全为 0 → 成交量 0、hasVolume false（隐藏格子）
  const fx = mergeMinuteQuoteInfo(points, { preClose: 1393.5 }, quoteFixture({ volume: 0 }))
  assert.equal(fx.volume, 0)
  assert.equal(fx.hasVolume, false)
  // 报价今开/最高/最低/昨收为 0 → 回退分时推算
  const zeroed = mergeMinuteQuoteInfo(
    points,
    { preClose: 1393.5 },
    quoteFixture({ open: 0, high: 0, low: 0, previousClose: 0 }),
  )
  assert.equal(zeroed.open, 1394.1)
  assert.equal(zeroed.high, 1394.2)
  assert.equal(zeroed.low, 1394.1)
  assert.equal(zeroed.preClose, 1393.5)
  assert.equal(zeroed.preCloseLabel, '昨收')
})

test('基础信息合并：期货昨结算优先于报价昨收（f18），涨跌幅口径一致', () => {
  const points = [
    { time: '21:00', price: 16900, avg: 16890, volume: 100 },
    { time: '21:01', price: 16968, avg: 16910, volume: 200 },
  ]
  // 沪银主连实测：昨结算 16611、昨收（报价 f18）16771 —— 涨跌幅按昨结算（2.15%）
  const info = mergeMinuteQuoteInfo(
    points,
    { preClose: 16771, preSettlement: 16611 },
    quoteFixture({ previousClose: 16771, market: '113' }),
  )
  assert.equal(info.preClose, 16611, '结算基准优先，报价昨收不得覆盖')
  assert.equal(info.preCloseLabel, '昨结算')
  // 非期货（无 preSettlement）：仍按 报价昨收 → 分时推算 回退
  const stock = mergeMinuteQuoteInfo(points, { preClose: 98 }, quoteFixture())
  assert.equal(stock.preClose, 98.2)
  assert.equal(stock.preCloseLabel, '昨收')
  // preSettlement 为 0 / 缺失（A股指数实测为 0）→ 等同非期货
  const index = mergeMinuteQuoteInfo(points, { preClose: 98, preSettlement: 0 }, quoteFixture())
  assert.equal(index.preClose, 98.2)
  assert.equal(index.preCloseLabel, '昨收')
})

test('MIN_MINUTE_POINTS 至少为 2（过滤腾讯外股单点数据）', () => {
  assert.ok(MIN_MINUTE_POINTS >= 2)
})

// ---------------------------------------------------------------------------
// 覆盖性校验：首页每一张行情卡片都必须有分时源（金店金价 GS-*、恐慌指数 VIX 除外）
// ---------------------------------------------------------------------------

test('覆盖性：全球页全部卡片 code 均有分时源', () => {
  const codes = [
    ...GLOBAL_INDICES.map((item) => item.code),
    AVG_PRICE_CONFIG.code,
    ...MACRO_ASSETS.map((item) => item.code),
    ...INDUSTRY_BOARDS.map((item) => item.code),
  ]
  // 恐慌指数 VIX 刻意不配置分时源：仅 Yahoo ^VIX 有分时但大陆被墙、无大陆可直连源，
  // 卡片不显示「分时」角标、点击提示暂无数据（见 config/minute.ts MINUTE_SOURCES 注释）。
  const missing = codes.filter((code) => code !== 'VIX' && !hasMinuteSources(code))
  assert.deepEqual(missing, [], `缺少分时源: ${missing.join(', ')}`)
})

test('覆盖性：日韩页全部卡片 code（指数/个股/汇率）均有分时源', () => {
  const codes = [
    ...ASIA_INDICES.map((item) => item.code),
    ...ASIA_KR_STOCKS.map((item) => item.code),
    ...ASIA_JP_STOCKS.map((item) => item.code),
    ...ASIA_RATES.map((item) => item.code),
  ]
  const missing = codes.filter((code) => !hasMinuteSources(code))
  assert.deepEqual(missing, [], `缺少分时源: ${missing.join(', ')}`)
})

test('覆盖性：有色页全部金属 code 均有分时源', () => {
  const missing = METALS.map((item) => item.code).filter((code) => !hasMinuteSources(code))
  assert.deepEqual(missing, [], `缺少分时源: ${missing.join(', ')}`)
})

test('覆盖性：韩股/日股分时以东财为主源，Yahoo 保留兜底（大陆访问 Yahoo 被墙）', () => {
  // 韩股市场号 177 / 日股 176 为东财真实市场号（旧配置 116/151 实测 data:null）
  for (const stock of [...ASIA_KR_STOCKS, ...ASIA_JP_STOCKS]) {
    const sources = MINUTE_SOURCES[stock.code]
    assert.ok(sources, `${stock.code} 缺少分时源`)
    assert.ok(sources.em, `${stock.code} 应配置东财分时源`)
    assert.ok(sources.yahoo, `${stock.code} 应保留 Yahoo 兜底`)
    const expected = ASIA_KR_STOCKS.some((item) => item.code === stock.code) ? '177' : '176'
    assert.ok(
      sources.em!.startsWith(`${expected}.`),
      `${stock.code} 的 em 市场号应为 ${expected}: ${sources.em}`,
    )
    // 卡片报价兜底 emSecid 与分时 em 同源（口径一致）
    assert.equal(stock.emSecid, sources.em, `${stock.code} 卡片兜底与分时源不一致`)
  }
  // 汇率：东财可覆盖的 USDKRW/USDJPY 同样东财优先 + Yahoo 兜底
  for (const code of ['USDKRW', 'USDJPY']) {
    const sources = MINUTE_SOURCES[code]
    assert.ok(sources?.em, `${code} 应配置东财分时源`)
    assert.ok(sources?.yahoo, `${code} 应保留 Yahoo 兜底`)
  }
})

test('覆盖性：汇率分时以东财系为主源（大陆可访问），Yahoo 仅兜底', () => {
  // 东财 119/133 或交叉合成在大陆可直连；Yahoo 被墙，只作大陆外兜底
  for (const code of ['CNYKRW', 'CNYJPY', 'USDCNY']) {
    const sources = MINUTE_SOURCES[code]
    assert.ok(sources, `${code} 缺少分时源`)
    assert.ok(sources.em || sources.emCross, `${code} 应配置东财系主源（大陆可访问）`)
    assert.ok(sources.yahoo, `${code} 应保留 Yahoo 兜底`)
  }
  // 交叉合成两腿均为东财 secid，且与卡片报价/直盘同源
  const cross = MINUTE_SOURCES.CNYKRW?.emCross
  assert.ok(cross, 'CNYKRW 应配置交叉汇率合成')
  assert.equal(cross!.numerator, '119.USDKRW', '分子=美元/韩元（东财 119）')
  assert.equal(cross!.denominator, '133.USDCNH', '分母=美元/离岸人民币（东财 133）')
  assert.equal(MINUTE_SOURCES.CNYJPY?.em, '133.CNHJPY', 'CNYJPY 用离岸人民币兑日元')
  assert.equal(MINUTE_SOURCES.USDCNY?.em, '133.USDCNH', 'USDCNY 用离岸美元/人民币')
  // USDCNY 卡片报价源与分时页同 secid（离岸，东财 133.USDCNH），保证「卡片=分时」数值一致
  const usdcnyRate = ASIA_RATES.find((rate) => rate.code === 'USDCNY')
  assert.ok(usdcnyRate, '缺少 USDCNY 汇率配置')
  assert.equal(usdcnyRate!.name, '美元/离岸人民币', '卡片应明确标注离岸口径')
  assert.equal(usdcnyRate!.emSecid, '133.USDCNH', 'USDCNY 卡片东财 secid 应与分时源一致')
  assert.equal(usdcnyRate!.preferEm, true, 'USDCNY 卡片应东财优先（与分时同源）')
})

test('覆盖性：全球页 USDCNY 卡片与分时页同源（东财离岸 133.USDCNH）', () => {
  const usdcny = MACRO_ASSETS.find((asset) => asset.code === 'USDCNY')
  assert.ok(usdcny, '缺少 USDCNY 宏观资产配置')
  assert.equal(usdcny.name, '美元/离岸人民币', '卡片应明确标注离岸口径')
  const source = usdcny.sources[0]
  assert.equal(source?.kind, 'em_ulist', '应走东财 ulist（fltt=2 十进制，与分时同构）')
  assert.deepEqual(source?.secid, '133.USDCNH', '应与分时源 133.USDCNH 同 secid')
})

test('覆盖性：NG 卡片与分时页同源（东财 102.NG00Y 天然气），防误用铜 101.HG00Y', () => {
  const ng = MACRO_ASSETS.find((asset) => asset.code === 'NG')
  assert.ok(ng, '缺少 NG 宏观资产配置')
  const source = ng.sources[0]
  assert.equal(source?.kind, 'em_ulist')
  assert.deepEqual(
    source?.secid,
    '102.NG00Y',
    'NG 卡片应为 NYMEX 天然气 102.NG00Y（非 101.HG00Y 铜）',
  )
  assert.equal(MINUTE_SOURCES.NG?.em, '102.NG00Y', 'NG 分时源应为 102.NG00Y')
})

test('覆盖性：每个 code 至少配置一个源，且源格式合法', () => {
  for (const [code, sources] of Object.entries(MINUTE_SOURCES)) {
    const hasProxies = (sources.emProxies?.length ?? 0) > 0
    assert.ok(
      sources.em || sources.tc || sources.yahoo || hasProxies || sources.emCross,
      `${code} 未配置任何源`,
    )
    if (sources.em) {
      assert.match(sources.em, /^\d+\.[A-Za-z0-9_]+$/, `${code} 的 em 格式非法: ${sources.em}`)
    }
    if (sources.tc) {
      assert.ok(sources.tc.length > 0, `${code} 的 tc 为空`)
    }
    if (sources.yahoo) {
      assert.ok(sources.yahoo.length > 0, `${code} 的 yahoo 为空`)
    }
    if (sources.emProxies) {
      assert.ok(sources.emProxies.length > 0, `${code} 的 emProxies 为空`)
      for (const secid of sources.emProxies) {
        assert.match(secid, /^\d+\.[A-Za-z0-9_]+$/, `${code} 的 emProxies 格式非法: ${secid}`)
      }
    }
    if (sources.emCross) {
      assert.match(
        sources.emCross.numerator,
        /^\d+\.[A-Za-z0-9_]+$/,
        `${code} 的 emCross.numerator 格式非法: ${sources.emCross.numerator}`,
      )
      assert.match(
        sources.emCross.denominator,
        /^\d+\.[A-Za-z0-9_]+$/,
        `${code} 的 emCross.denominator 格式非法: ${sources.emCross.denominator}`,
      )
    }
  }
})

// ---------------------------------------------------------------------------
// 会话切换分时源（卡片展示什么，点进去就看什么）：
// 外盘时段有色 GOLD/SILVER/COPPER 卡片展示 COMEX 报价，分时切到已验证的 COMEX 源；
// 美股时段板块 / 外盘无分时源的金属用 us- 前缀占位（无源），点击给出提示，
// 绝不跳转到与卡片展示口径不一致（A股/沪主连）的分时。
// ---------------------------------------------------------------------------

test('会话切换：外盘 GOLD/SILVER/COPPER 分时源为 COMEX（与卡片口径一致）', () => {
  const expected: Record<string, string> = {
    'GOLD-US': '101.GC00Y',
    'SILVER-US': '101.SI00Y',
    'COPPER-US': '101.HG00Y',
  }
  for (const [code, em] of Object.entries(expected)) {
    assert.ok(hasMinuteSources(code), `${code} 应配置分时源`)
    assert.equal(MINUTE_SOURCES[code]?.em, em, `${code} 应为 COMEX 分时 ${em}`)
  }
})

test('会话切换：美股时段板块（us-BKxxxx）为代理股分时均值合成，代理与 tabbar 配置一致', () => {
  const missing: string[] = []
  for (const board of INDUSTRY_BOARDS) {
    const code = `us-${board.code}`
    const sources = MINUTE_SOURCES[code]
    if (!sources?.emProxies) {
      missing.push(code)
      continue
    }
    assert.deepEqual(
      sources.emProxies,
      board.proxies,
      `${code} 的代理列表应与 INDUSTRY_BOARDS 一致（避免首页行情与分时口径错位）`,
    )
  }
  assert.deepEqual(missing, [], `缺少代理合成分时源: ${missing.join(', ')}`)
})

test('会话切换：全部美股代理股均有中文名映射（US_PROXY_NAMES 覆盖 INDUSTRY_BOARDS 全部代理）', () => {
  const missing: string[] = []
  const allProxies = new Set(INDUSTRY_BOARDS.flatMap((board) => board.proxies))
  for (const secid of allProxies) {
    const ticker = secid.replace(/^\d+\./, '')
    if (!US_PROXY_NAMES[ticker]) missing.push(ticker)
  }
  assert.deepEqual(missing, [], `缺少中文名映射: ${missing.join(', ')}`)
})

test('会话切换：外盘无分时源的金属（us-*）必须无分时源，避免误入沪主连/A股分时', () => {
  // 外盘时段卡片展示外盘报价（hf_*）但无已验证外盘分时源的金属
  const expectedUsUnavailable = ['ALUMINUM', 'ZINC', 'NICKEL', 'TIN', 'TUNGSTEN']
  for (const code of expectedUsUnavailable) {
    assert.ok(!hasMinuteSources(`us-${code}`), `us-${code} 不应配置分时源`)
  }
})

test('分时成交柱着色：红涨、绿跌、平盘白/灰柱判定', () => {
  // 走势1：昨收 10.0
  // 点0: 10.5 (开盘价相对昨收10.0 > 10.0 -> up / 红柱)
  // 点1: 10.8 (开盘价10.5, 收盘价10.8 > 10.5 -> up / 红柱)
  // 点2: 10.6 (开盘价10.8, 收盘价10.6 < 10.8 -> down / 绿柱)
  // 点3: 10.6 (开盘价10.6, 收盘价10.6 == 10.6 -> flat / 白灰柱)
  // 点4: 10.9 (开盘价10.6, 收盘价10.9 > 10.6 -> up / 红柱)
  const points1 = [
    { price: 10.5 },
    { price: 10.8 },
    { price: 10.6 },
    { price: 10.6 },
    { price: 10.9 },
  ]
  const result1 = computeMinuteVolumeDirections(points1, 10.0)
  assert.deepEqual(result1, ['up', 'up', 'down', 'flat', 'up'])

  // 走势2：低开走势，昨收 10.0
  // 点0: 9.2 (< 10.0 -> down / 绿柱)
  // 点1: 9.5 (> 9.2 -> up / 红柱)
  // 点2: 9.5 (== 9.5 -> flat / 白灰柱)
  // 点3: 9.4 (< 9.5 -> down / 绿柱)
  const points2 = [{ price: 9.2 }, { price: 9.5 }, { price: 9.5 }, { price: 9.4 }]
  const result2 = computeMinuteVolumeDirections(points2, 10.0)
  assert.deepEqual(result2, ['down', 'up', 'flat', 'down'])

  // 走势3：首点平昨收，昨收 10.0
  // 点0: 10.0 (== 10.0 -> flat / 白灰柱)
  // 点1: 10.1 (> 10.0 -> up / 红柱)
  const points3 = [{ price: 10.0 }, { price: 10.1 }]
  const result3 = computeMinuteVolumeDirections(points3, 10.0)
  assert.deepEqual(result3, ['flat', 'up'])

  // 走势4：无昨收走势
  // 点0: 100.0 (无昨收基准 -> flat)
  // 点1: 99.0 (< 100.0 -> down / 绿柱)
  // 点2: 101.0 (> 99.0 -> up / 红柱)
  const points4 = [{ price: 100.0 }, { price: 99.0 }, { price: 101.0 }]
  const result4 = computeMinuteVolumeDirections(points4, null)
  assert.deepEqual(result4, ['flat', 'down', 'up'])
})
