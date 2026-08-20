import assert from 'node:assert/strict'
import test from 'node:test'

import {
  MIN_MINUTE_POINTS,
  buildCompositePoints,
  parseEastmoneyTrends,
  parseTencentMinuteNode,
  parseYahooMinuteResult,
  shortTime,
} from '../utils/minute-parser.ts'
import { MINUTE_SOURCES, US_PROXY_NAMES, hasMinuteSources } from '../config/minute.ts'
import { computeMinuteVolumeDirections } from '../utils/minute.ts'
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

test('东财：keepFullTime 保留完整时间戳，name 透传证券中文名', () => {
  const data = {
    preClose: 219.74,
    name: '英伟达',
    trends: [
      '2026-08-19 21:30,221.670,222.070,222.070,221.670,2801010,618492368.000,220.8105',
      '2026-08-20 00:00,219.225,219.321,219.350,219.210,124395,27275530.000,219.2459',
    ],
  }
  // 默认短时间
  const normal = parseEastmoneyTrends(data)
  assert.ok(normal)
  assert.equal(normal!.name, '英伟达')
  assert.equal(normal!.points[0]!.time, '21:30')
  assert.equal(normal!.points[1]!.time, '00:00')
  // keepFullTime：保留完整时间戳（字典序即时间序，跨零点不重排）
  const full = parseEastmoneyTrends(data, { keepFullTime: true })
  assert.ok(full)
  assert.equal(full!.points[0]!.time, '2026-08-19 21:30')
  assert.equal(full!.points[1]!.time, '2026-08-20 00:00')
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
  assert.equal(points[0]!.price, 100, '(100.5+99.5)/2')
  assert.equal(points[0]!.volume, 150, '成交量取代理之和')
  assert.equal(points[1]!.time, '21:31')
  assert.equal(points[1]!.price, 100, '(101+99)/2')
  assert.equal(points[2]!.time, '00:00', '跨零点 00:00 排在 21:31 之后')
  assert.equal(points[2]!.price, 102, '仅一只代理有数据时取该值')
  assert.equal(points[2]!.volume, 300)
  assert.equal(points[0]!.avg, null, '合成序列无均价')
})

test('合成：无任何序列返回空数组', () => {
  assert.deepEqual(buildCompositePoints([]), [])
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
    AVG_PRICE_CONFIG.code,
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
    const hasProxies = (sources.emProxies?.length ?? 0) > 0
    assert.ok(sources.em || sources.tc || sources.yahoo || hasProxies, `${code} 未配置任何源`)
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
