import assert from 'node:assert/strict'
import test from 'node:test'

import {
  MIN_MINUTE_POINTS,
  parseEastmoneyTrends,
  parseTencentMinuteNode,
  parseYahooMinuteResult,
  shortTime,
} from '../utils/minute-parser.ts'
import { MINUTE_SOURCES, hasMinuteSources } from '../config/minute.ts'
import {
  ASIA_INDICES,
  ASIA_JP_STOCKS,
  ASIA_KR_STOCKS,
  ASIA_RATES,
  GLOBAL_INDICES,
  INDUSTRY_BOARDS,
  MACRO_ASSETS,
  METALS,
} from '../config/tabbar.ts'

// ---------------------------------------------------------------------------
// 东财分时（trends2）
// 每行（fields2=f51..f58）：[0]时间 [1]现价 [5]成交量 [6]成交额 [7]均价
// ---------------------------------------------------------------------------

test('东财：解析 trends 行为 MinutePoint，昨收透传', () => {
  const data = {
    preClose: 3990.3,
    trends: [
      '2026-08-19 09:30,3952.12,3952.12,3952.12,3952.12,5649180,13909757184.00,3951.819',
      '2026-08-19 09:31,3953.55,3955.56,3955.68,3952.41,15142187,32132489728.00,3951.438',
    ],
  }
  const result = parseEastmoneyTrends(data)
  assert.ok(result)
  assert.equal(result!.preClose, 3990.3)
  assert.equal(result!.points.length, 2)
  assert.deepEqual(result!.points[0]!, {
    time: '09:30',
    price: 3952.12,
    avg: 3951.819,
    volume: 5649180,
    amount: 13909757184,
  })
  assert.equal(result!.points[1]!.time, '09:31')
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

test('MIN_MINUTE_POINTS 至少为 2（过滤腾讯外股单点数据）', () => {
  assert.ok(MIN_MINUTE_POINTS >= 2)
})

// ---------------------------------------------------------------------------
// 覆盖性校验：首页每一张行情卡片都必须有分时源（金店金价 GS-* 除外）
// ---------------------------------------------------------------------------

test('覆盖性：全球页全部卡片 code 均有分时源', () => {
  const codes = [
    ...GLOBAL_INDICES.map((item) => item.code),
    ...MACRO_ASSETS.map((item) => item.code),
    ...INDUSTRY_BOARDS.map((item) => item.code),
  ]
  const missing = codes.filter((code) => !hasMinuteSources(code))
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

test('覆盖性：每个 code 至少配置一个源，且源格式合法', () => {
  for (const [code, sources] of Object.entries(MINUTE_SOURCES)) {
    assert.ok(sources.em || sources.tc || sources.yahoo, `${code} 未配置任何源`)
    if (sources.em) {
      assert.match(sources.em, /^\d+\.[A-Za-z0-9_]+$/, `${code} 的 em 格式非法: ${sources.em}`)
    }
    if (sources.tc) {
      assert.ok(sources.tc.length > 0, `${code} 的 tc 为空`)
    }
    if (sources.yahoo) {
      assert.ok(sources.yahoo.length > 0, `${code} 的 yahoo 为空`)
    }
  }
})
