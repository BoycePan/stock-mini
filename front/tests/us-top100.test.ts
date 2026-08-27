import assert from 'node:assert/strict'
import test from 'node:test'

import { EM_US_SECID_RE, hasMinuteSources, resolveMinuteSources } from '../config/minute.ts'
import { resolveMinuteSession } from '../utils/minute-session.ts'
import { formatUsMarketCap, parseUsTop100 } from '../utils/us-stocks.ts'

// ---------------------------------------------------------------------------
// parseUsTop100：clist/get 响应 → 归一化列表
// ---------------------------------------------------------------------------

test('parseUsTop100：正常行解析为 secid / 中文名 / 数值', () => {
  const body = {
    data: {
      total: 13805,
      diff: [
        {
          f12: 'NVDA',
          f13: 105,
          f14: '英伟达',
          f2: 209.66,
          f3: -1.59,
          f4: -3.39,
          f20: 5052806000000,
        },
        { f12: 'AAPL', f13: 105, f14: '苹果', f2: 313.45, f3: 1.15, f4: 3.55, f20: 4574545721000 },
      ],
    },
  }
  const items = parseUsTop100(body)
  assert.equal(items.length, 2)
  assert.deepEqual(items[0]!, {
    code: 'NVDA',
    market: 105,
    secid: '105.NVDA',
    name: '英伟达',
    price: 209.66,
    pct: -1.59,
    change: -3.39,
    marketCap: 5052806000000,
  })
  assert.equal(items[1]!.secid, '105.AAPL')
})

test('parseUsTop100："-" 字段归一为 null，缺失中文名回退代码', () => {
  const body = {
    data: {
      diff: [
        // 停牌/无数据行：价格与涨跌为 "-"
        {
          f12: 'QULL',
          f13: 107,
          f14: 'ETRACS 2x Leveraged',
          f2: '-',
          f3: '-',
          f4: '-',
          f20: 272654434250,
        },
        // 缺中文名 → 回退裸代码
        { f12: 'SPCX', f13: 105, f14: '', f2: 139.63, f3: 1.22, f4: 1.68, f20: 1840571933720 },
      ],
    },
  }
  const items = parseUsTop100(body)
  assert.equal(items[0]!.price, null)
  assert.equal(items[0]!.pct, null)
  assert.equal(items[0]!.change, null)
  assert.equal(items[0]!.marketCap, 272654434250)
  assert.equal(items[1]!.name, 'SPCX')
})

test('parseUsTop100：缺代码 / 非美股市场号的行被跳过', () => {
  const body = {
    data: {
      diff: [
        { f12: '', f13: 105, f14: '无代码', f2: 1, f3: 0, f4: 0, f20: 1 },
        { f12: 'ABCD', f13: 99, f14: '非美股市场', f2: 1, f3: 0, f4: 0, f20: 1 },
        {
          f12: 'NVDA',
          f13: 105,
          f14: '英伟达',
          f2: 209.66,
          f3: -1.59,
          f4: -3.39,
          f20: 5052806000000,
        },
        {
          f12: 'BRK_B',
          f13: 106,
          f14: '伯克希尔哈撒韦-B',
          f2: 504.91,
          f3: 0.12,
          f4: 0.6,
          f20: 1080865967391,
        },
      ],
    },
  }
  const items = parseUsTop100(body)
  assert.equal(items.length, 2)
  assert.equal(items[0]!.code, 'NVDA')
  assert.equal(items[1]!.secid, '106.BRK_B')
})

test('parseUsTop100：空响应 / 缺 data 返回空数组', () => {
  assert.deepEqual(parseUsTop100(null), [])
  assert.deepEqual(parseUsTop100({}), [])
  assert.deepEqual(parseUsTop100({ data: {} }), [])
})

// ---------------------------------------------------------------------------
// formatUsMarketCap：美元市值展示
// ---------------------------------------------------------------------------

test('formatUsMarketCap：万亿 / 亿 / 万 / 元 分段', () => {
  assert.equal(formatUsMarketCap(5052806000000), '$5.05万亿')
  assert.equal(formatUsMarketCap(4574545721000), '$4.57万亿')
  assert.equal(formatUsMarketCap(947643378518), '$9476亿')
  assert.equal(formatUsMarketCap(524265668792), '$5243亿')
  assert.equal(formatUsMarketCap(50000), '$5万')
  assert.equal(formatUsMarketCap(123), '$123')
})

test('formatUsMarketCap：null / 非有限数返回 --', () => {
  assert.equal(formatUsMarketCap(null), '--')
  assert.equal(formatUsMarketCap(Number.NaN), '--')
})

// ---------------------------------------------------------------------------
// 分时源兜底：美股 secid（config/minute.ts EM_US_SECID_RE）
// ---------------------------------------------------------------------------

test('EM_US_SECID_RE：仅匹配美股三大市场号 + 合法代码', () => {
  assert.equal(EM_US_SECID_RE.test('105.NVDA'), true)
  assert.equal(EM_US_SECID_RE.test('106.BRK_B'), true)
  assert.equal(EM_US_SECID_RE.test('107.AAPL'), true)
  assert.equal(EM_US_SECID_RE.test('105.nvda'), true) // 大小写不敏感
  assert.equal(EM_US_SECID_RE.test('1.000001'), false) // 非美股市场
  assert.equal(EM_US_SECID_RE.test('113.aum'), false) // 沪金主连
  assert.equal(EM_US_SECID_RE.test('105.'), false)
  assert.equal(EM_US_SECID_RE.test('NVDA'), false)
  assert.equal(EM_US_SECID_RE.test('us-top100'), false)
})

test('resolveMinuteSources：美股 secid 兜底为东财分时源，未登记代码返回 null', () => {
  assert.deepEqual(resolveMinuteSources('105.NVDA'), { em: '105.NVDA' })
  assert.deepEqual(resolveMinuteSources('106.BRK_B'), { em: '106.BRK_B' })
  assert.equal(resolveMinuteSources('NVDA'), null)
  assert.equal(resolveMinuteSources('us-top100'), null)
  assert.equal(resolveMinuteSources(''), null)
})

test('hasMinuteSources：美股 secid 视为有分时源，入口卡等无源代码返回 false', () => {
  assert.equal(hasMinuteSources('105.NVDA'), true)
  assert.equal(hasMinuteSources('106.BRK_B'), true)
  assert.equal(hasMinuteSources('NVDA'), false)
  assert.equal(hasMinuteSources('us-top100'), false)
})

// ---------------------------------------------------------------------------
// 分时时段识别（utils/minute-session.ts）
// ---------------------------------------------------------------------------

test('resolveMinuteSession：美股 secid 识别为美股时段', () => {
  assert.equal(resolveMinuteSession('105.NVDA'), 'us')
  assert.equal(resolveMinuteSession('106.BRK_B'), 'us')
  assert.equal(resolveMinuteSession('107.AAPL'), 'us')
  assert.equal(resolveMinuteSession('NVDA'), 'continuous')
  assert.equal(resolveMinuteSession('1.000001'), 'continuous')
})
