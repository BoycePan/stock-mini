import assert from 'node:assert/strict'
import test from 'node:test'

import {
  MIN_KLINE_BARS,
  normalizeKlines,
  parseJsonLoose,
  parseSinaAshareKline,
  parseSinaForexKline,
  parseSinaJsonpKline,
  parseTencentKlineBody,
  SINA_GLOBAL_FUTURES_FIELDS,
  SINA_INNER_FUTURES_FIELDS,
  SINA_US_FIELDS,
  stripJsonp,
} from '../utils/kline-parser.ts'

// ---------------------------------------------------------------------------
// 腾讯 K 线：行格式 [日期, 开, 收, 高, 低, 量]（第 3 列是收盘、第 4 列才是最高）
// ---------------------------------------------------------------------------

test('腾讯 K 线：按 日期/开/收/高/低/量 解析，qfq 前缀与非复权键都兼容', () => {
  const body = {
    code: 0,
    data: {
      sh600519: {
        qfqday: [
          ['2026-09-09', '1305.010', '1290.880', '1309.300', '1286.680', '32226.000'],
          ['2026-09-10', '1291.000', '1285.130', '1294.990', '1282.000', '18900'],
        ],
        qt: { sh600519: ['1', '贵州茅台'] },
      },
    },
  }
  const bars = parseTencentKlineBody(body, 'day')
  assert.ok(bars)
  assert.equal(bars.length, 2)
  assert.deepEqual(bars[0], {
    time: '2026-09-09',
    open: 1305.01,
    close: 1290.88,
    high: 1309.3,
    low: 1286.68,
    volume: 32226,
  })
  // 最高必须大于开盘、最低必须小于收盘：验证列序没有把收盘当最高读
  assert.ok((bars[0]?.high ?? 0) > (bars[0]?.open ?? 0))
  assert.ok((bars[0]?.low ?? 0) < (bars[0]?.close ?? 0))
})

test('腾讯 K 线：周/月键名匹配 + 行内混入对象（港股分红信息）也能解析前 6 位', () => {
  const body = {
    data: {
      hk00700: {
        week: [
          [
            '2026-09-04',
            '451.000',
            '442.800',
            '456.200',
            '433.000',
            '103193261.000',
            { cqr: '2026-09-04' },
          ],
          ['2026-09-11', '445.000', '448.000', '450.000', '440.000', '90000000.000', {}],
        ],
      },
    },
  }
  const bars = parseTencentKlineBody(body, 'week')
  assert.ok(bars)
  assert.equal(bars.length, 2)
  assert.equal(bars[1]?.close, 448)
  // 该响应没有 week 键以外的周期，取 month 应返回 null
  assert.equal(parseTencentKlineBody(body, 'month'), null)
})

test('腾讯 K 线：空数组 / 无 data / 行数不足返回 null', () => {
  assert.equal(parseTencentKlineBody({ data: { usDJI: { day: [] } } }, 'day'), null)
  assert.equal(parseTencentKlineBody({}, 'day'), null)
  assert.equal(parseTencentKlineBody(undefined, 'day'), null)
  assert.equal(
    parseTencentKlineBody(
      { data: { sh600519: { day: [['2026-09-09', '1', '1', '1', '1', '1']] } } },
      'day',
    ),
    null,
    '仅 1 根（少于 MIN_KLINE_BARS）视为无效',
  )
})

// ---------------------------------------------------------------------------
// 新浪 A股 / 美股 / 期货 / 外汇
// ---------------------------------------------------------------------------

test('新浪 A股 K 线：JSON 数组（day/open/high/low/close/volume）', () => {
  const text = JSON.stringify([
    {
      day: '2026-09-11',
      open: '1285.150',
      high: '1286.150',
      low: '1263.010',
      close: '1275.160',
      volume: '3480142',
    },
    {
      day: '2026-09-14',
      open: '1277.270',
      high: '1285.530',
      low: '1270.360',
      close: '1277.960',
      volume: '16571',
    },
  ])
  const bars = parseSinaAshareKline(text)
  assert.ok(bars)
  assert.equal(bars.length, 2)
  assert.equal(bars[1]?.close, 1277.96)
})

test('新浪 A股 K 线：微信自动解析成对象时同样可用（非字符串入参）', () => {
  const parsed = [
    { day: '2026-09-11', open: 1.2, high: 1.8, low: 0.9, close: 1.5, volume: 10 },
    { day: '2026-09-14', open: 1.5, high: 1.9, low: 1.4, close: 1.6, volume: 12 },
  ]
  const bars = parseSinaAshareKline(parsed)
  assert.ok(bars)
  assert.equal(bars[1]?.close, 1.6)
})

test('新浪美股 JSONP：剥 var _x=(...) 包裹后按 d/o/h/l/c/v 解析', () => {
  const text =
    '/*<script>location.href=\'//sina.com\';</script>*/var _dshkline=([{"d":"2026-09-11","o":"327.45","h":"336.22","l":"326.30","c":"332.27","v":"50716865","a":"0"},{"d":"2026-09-14","o":"333.00","h":"335.00","l":"330.00","c":"331.00","v":"40000000","a":"0"}]);'
  const bars = parseSinaJsonpKline(text, SINA_US_FIELDS)
  assert.ok(bars)
  assert.equal(bars.length, 2)
  assert.equal(bars[0]?.high, 336.22)
  assert.equal(bars[0]?.volume, 50716865)
})

test('新浪内盘期货 JSONP：d/o/h/l/c/v 字段（沪金主连）', () => {
  const text =
    'var _dshkline=([{"d":"2026-09-11","o":"820.00","h":"826.00","l":"815.00","c":"824.00","v":"103364","p":"16342","s":"0.000"},{"d":"2026-09-14","o":"824.00","h":"830.00","l":"820.00","c":"828.00","v":"90000","p":"16000","s":"0.000"}]);'
  const bars = parseSinaJsonpKline(text, SINA_INNER_FUTURES_FIELDS)
  assert.ok(bars)
  assert.equal(bars[1]?.close, 828)
})

test('新浪外盘期货 JSONP：具名全拼字段（COMEX 黄金）', () => {
  const text =
    'var _dshkline=([{"date":"2026-09-11","open":"3650.0","high":"3680.0","low":"3640.0","close":"3670.0","volume":"12000","position":"0"},{"date":"2026-09-14","open":"3670.0","high":"3700.0","low":"3660.0","close":"3690.0","volume":"9000","position":"0"}]);'
  const bars = parseSinaJsonpKline(text, SINA_GLOBAL_FUTURES_FIELDS)
  assert.ok(bars)
  assert.equal(bars[0]?.open, 3650)
  assert.equal(bars[1]?.close, 3690)
})

test('新浪外汇日 K：管道分隔字符串，字段序为 日期/开/低/高/收（第 3 列是最低）', () => {
  // 实测样例（USDCNH 2014-11-07 / 11-10）：若按 开/高/低/收 读会得到 low > close 的非法 K 线
  const text =
    '/*<script>location.href=\'//sina.com\';</script>*/var _dshkline=("2014-11-07,6.13750,6.13030,6.13770,6.13410,|2014-11-10,6.13130,6.11910,6.15760,6.12230,|");'
  const bars = parseSinaForexKline(text)
  assert.ok(bars)
  assert.equal(bars.length, 2)
  assert.equal(bars[0]?.open, 6.1375)
  assert.equal(bars[0]?.low, 6.1303)
  assert.equal(bars[0]?.high, 6.1377)
  assert.equal(bars[0]?.close, 6.1341)
  for (const bar of bars) {
    assert.ok(
      bar.low <= Math.min(bar.open, bar.close),
      `low 必须不高于开收：${JSON.stringify(bar)}`,
    )
    assert.ok(
      bar.high >= Math.max(bar.open, bar.close),
      `high 必须不低于开收：${JSON.stringify(bar)}`,
    )
  }
})

test('新浪外汇：空数据（msg: data is empty）返回 null', () => {
  const text =
    '/*<script>location.href=\'//sina.com\';</script>*/var _dshkline=({"msg":"data is empty"});'
  assert.equal(parseSinaForexKline(text), null)
})

// ---------------------------------------------------------------------------
// 归一化 / 宽松解析工具
// ---------------------------------------------------------------------------

test('normalizeKlines：过滤非正价格、按时间升序、同时间去重（保留后一根）', () => {
  const bars = normalizeKlines([
    { time: '2026-09-14', open: 10, high: 11, low: 9, close: 10.5, volume: 100 },
    { time: '2026-09-11', open: 9, high: 10, low: 8, close: 9.5, volume: 100 },
    { time: '2026-09-14', open: 10, high: 12, low: 9, close: 11.5, volume: 200 },
    { time: '2026-09-15', open: 0, high: 0, low: 0, close: 0, volume: 0 },
    { time: '', open: 1, high: 1, low: 1, close: 1, volume: 1 },
  ])
  assert.ok(bars)
  assert.deepEqual(
    bars.map((k) => k.time),
    ['2026-09-11', '2026-09-14'],
  )
  assert.equal(bars[1]?.close, 11.5, '同时间重复根保留最后一根')
  assert.equal(MIN_KLINE_BARS, 2)
})

test('parseJsonLoose / stripJsonp：JSONP 包裹、纯 JSON、脏前缀都能解析', () => {
  assert.deepEqual(parseJsonLoose('[{"a":1}]'), [{ a: 1 }])
  assert.deepEqual(parseJsonLoose('var _x=([{"a":1}]);'), [{ a: 1 }])
  assert.deepEqual(parseJsonLoose('/*c*/var _x=([{"a":1}])'), [{ a: 1 }])
  assert.deepEqual(parseJsonLoose({ a: 1 }), { a: 1 })
  assert.equal(parseJsonLoose('not json'), null)
  assert.equal(stripJsonp('var _x=([1,2])'), '[1,2]')
  assert.equal(stripJsonp('[1,2]'), '[1,2]')
})
