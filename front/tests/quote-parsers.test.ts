import assert from 'node:assert/strict'
import test from 'node:test'

import {
  displayName,
  isAbnormalPct,
  normalizeEastmoneyQuote,
  parseJumpMpBody,
  parseQuoteTime,
  parseSinaQuote,
  parseSinaText,
  parseTencentText,
  priceDivisor,
  quoteTimeToDate,
  sinaGbProxyPct,
  tencentQuoteOf,
  validateQuote,
} from '../utils/quote-parser.ts'
import { getAStockPhase, getMarketSession, getUsPhase, isUsDst } from '../utils/market-clock.ts'
import { aShareSecid, bareCode, findConsensus, similarQuotes } from '../utils/quote-consensus.ts'
import type { SourceQuote } from '../types/quote.ts'

// ---------------------------------------------------------------------------
// 腾讯文本解析（索引规则见 docs/tabbar-api.md ①）
// ---------------------------------------------------------------------------

function tencentLine(
  code: string,
  name: string,
  price: number,
  prev: number,
  pct: number,
  change: string,
  time = '20260817150000',
): string {
  const fields = new Array(40).fill('0')
  fields[0] = '1'
  fields[1] = name
  fields[2] = code
  fields[3] = String(price)
  fields[4] = String(prev)
  fields[5] = String(prev)
  fields[6] = String(price + 10)
  fields[7] = String(price - 10)
  fields[8] = '1000000'
  fields[9] = '200000000'
  fields[30] = time
  fields[31] = change
  fields[32] = String(pct)
  return `v_${code}="${fields.join('~')}";`
}

test('腾讯：解析 v_<code> 文本并按固定索引取值', () => {
  const text = [
    tencentLine('sh000001', '上证指数', 3421.5, 3400, 0.63, '21.50'),
    tencentLine('usQQQ', '纳斯达克', 29722.3, 29500, 0.75, '222.30'),
  ].join('\n')
  const map = parseTencentText(text, ['sh000001', 'usQQQ'])

  const quote = tencentQuoteOf('sh000001', map.get('sh000001') ?? [])
  assert.equal(quote.valid, true)
  assert.equal(quote.name, '上证指数')
  assert.equal(quote.latestPrice, 3421.5)
  assert.equal(quote.previousClose, 3400)
  assert.equal(quote.change, 21.5)
  assert.equal(quote.changePercent, 0.63)
  assert.equal(quote.quoteTime, '2026-08-17 15:00:00')

  const us = tencentQuoteOf('usQQQ', map.get('usQQQ') ?? [])
  assert.equal(us.latestPrice, 29722.3)
  assert.equal(us.valid, true)
})

test('腾讯：字段不足 35 个视为失败', () => {
  const quote = tencentQuoteOf('sh000001', ['1', '上证指数', '000001'])
  assert.equal(quote.valid, false)
  assert.equal(quote.latestPrice, null)
})

test('腾讯：pv_none_match（空代码）拒绝', () => {
  const quote = tencentQuoteOf('sh000001', ['pv_none_match'])
  assert.equal(quote.valid, false)
})

test('腾讯：涨跌额缺失时按 现价-昨收 反推', () => {
  const text = tencentLine('sh000001', '上证指数', 3421.5, 3400, 0.63, '')
  const map = parseTencentText(text, ['sh000001'])
  const quote = tencentQuoteOf('sh000001', map.get('sh000001') ?? [])
  assert.equal(quote.change, 21.5)
})

// ---------------------------------------------------------------------------
// 新浪文本解析（索引规则见 docs/tabbar-api.md ②）
// ---------------------------------------------------------------------------

test('新浪：空行 key 视为无数据', () => {
  const map = parseSinaText('hq_str_hf_GC="";', ['hf_GC'])
  const quote = parseSinaQuote('hf_GC', map.get('hf_GC') ?? [])
  assert.equal(quote.price, null)
  assert.equal(quote.changePercent, null)
})

test('新浪 hf_ 贵金属：现价 [0]、昨收 [7]', () => {
  const fields = ['4410.5', 'x', 'x', 'x', 'x', 'x', 'x', '4390.2']
  const quote = parseSinaQuote('hf_GC', fields)
  assert.equal(quote.price, 4410.5)
  assert.equal(quote.previousClose, 4390.2)
  assert.ok(Math.abs((quote.changePercent as number) - 0.4623) < 0.001)
})

test('新浪 nf_ 非金属：现价 [8]、昨收 [10]', () => {
  const fields = new Array(14).fill('x')
  fields[8] = '720.5'
  fields[10] = '715.0'
  const quote = parseSinaQuote('nf_AU0', fields)
  assert.equal(quote.price, 720.5)
  assert.equal(quote.previousClose, 715.0)
})

test('新浪 znb_ / int_ 指数：现价 [1]、涨跌额 [2]、涨跌幅 [3]', () => {
  const fields = ['KOSPI', '6200.0', '12.5', '0.20']
  const kospi = parseSinaQuote('znb_KOSPI', fields)
  assert.equal(kospi.price, 6200)
  assert.equal(kospi.change, 12.5)
  assert.equal(kospi.changePercent, 0.2)

  const nikkei = parseSinaQuote('int_nikkei', ['日经225', '40000', '300', '0.75'])
  assert.equal(nikkei.price, 40000)
  assert.equal(nikkei.changePercent, 0.75)
})

test('新浪 DINIW 美元指数：现价 [1]、昨收 [7]（缺失时 [3]）', () => {
  const fields = ['美元指数', '99.5', 'x', 'x', 'x', 'x', 'x', '99.2']
  const quote = parseSinaQuote('DINIW', fields)
  assert.equal(quote.price, 99.5)
  assert.equal(quote.previousClose, 99.2)

  const fallback = parseSinaQuote('DINIW', ['美元指数', '99.5', 'x', '99.0'])
  assert.equal(fallback.previousClose, 99.0)
})

test('新浪 gb_ 美股（宏观消费方）：现价 [1]、昨收 [2]、涨跌幅 [3]', () => {
  const fields = ['iShares TLT', '92.5', '91.8', '0.76']
  const quote = parseSinaQuote('gb_TLT', fields)
  assert.equal(quote.price, 92.5)
  assert.equal(quote.previousClose, 91.8)
  assert.equal(quote.changePercent, 0.76)
})

test('新浪 gb_ 美股代理（fetchUsProxyChangeMap 消费方）：涨跌幅取 [2]', () => {
  assert.equal(sinaGbProxyPct(['英伟达', '200.5', '1.23', 'x']), 1.23)
  assert.equal(sinaGbProxyPct(['x', 'x', '95.0']), null) // |pct|>=80 丢弃
})

test('新浪 fx_ 外汇：优先用新浪自带 [10] 涨跌幅 / [11] 涨跌额（实测 fx_ 字段布局）', () => {
  const fields = [
    '22:17:43', // [0] 时间
    '1411.15', // [1] 现价
    '1411.37', // [2] 卖价
    '1415.48', // [3] 昨收
    '88800', // [4] 成交量
    '1415.53', // [5] 今开
    '1416.68', // [6] 最高
    '1407.80', // [7] 最低
    '1411.15', // [8]
    '美元兑韩元即期汇率', // [9] 名称
    '-0.31', // [10] 涨跌幅(%)
    '-4.33', // [11] 涨跌额
    '0.006273', // [12]
    '',
    '1561.50', // [14] 区间高
    '1407.12', // [15] 区间低
    '',
    '2026-08-18', // [17] 日期
  ]
  const quote = parseSinaQuote('fx_susdkrw', fields)
  assert.equal(quote.price, 1411.15)
  assert.equal(quote.previousClose, 1415.48)
  assert.equal(quote.change, -4.33)
  assert.equal(quote.changePercent, -0.31)
})

test('新浪 fx_ 外汇：涨跌字段缺失时按 现价-昨收 反推', () => {
  const fields = ['人民币/韩元', '191.2', 'x', '190.8']
  const quote = parseSinaQuote('fx_scnykrw', fields)
  assert.equal(quote.price, 191.2)
  assert.equal(quote.previousClose, 190.8)
  assert.ok(Math.abs((quote.change as number) - 0.4) < 1e-9)
  assert.ok(Math.abs((quote.changePercent as number) - 0.2096) < 0.001)
})

test('新浪 A股/指数默认格式：现价 [3]、昨收 [2]', () => {
  const fields = [
    '贵州茅台',
    '1500',
    '1490',
    '1510',
    '1520',
    '1480',
    '0',
    '0',
    '5000000',
    '7000000000',
  ]
  const quote = parseSinaQuote('sh600519', fields)
  assert.equal(quote.price, 1510)
  assert.equal(quote.previousClose, 1490)
})

// ---------------------------------------------------------------------------
// 东财 stock/get 归一化（docs ③）
// ---------------------------------------------------------------------------

test('东财：价格按 10^(f152||2) 除、涨跌幅 ÷100', () => {
  const quote = normalizeEastmoneyQuote('105.QQQ', {
    f57: 'QQQ',
    f58: '纳指100ETF',
    f43: 50000,
    f60: 49000,
    f46: 50100,
    f44: 50500,
    f45: 49800,
    f169: 1000,
    f170: 204,
    f152: 2,
    f86: Math.floor(Date.now() / 1000) - 60,
    f107: 105,
  })
  assert.ok(quote)
  assert.equal(quote.latestPrice, 500)
  assert.equal(quote.previousClose, 490)
  assert.equal(quote.open, 501)
  assert.equal(quote.high, 505)
  assert.equal(quote.low, 498)
  assert.equal(quote.change, 10)
  assert.equal(quote.changePercent, 2.04)
  assert.equal(quote.isStale, false)
  assert.equal(quote.marketName, '美股')
})

test('东财：港股/韩股（f107=116）恒除 1000', () => {
  const quote = normalizeEastmoneyQuote('116.005930', {
    f57: '005930',
    f58: '三星电子',
    f43: 230000,
    f60: 228000,
    f152: 0,
    f86: Math.floor(Date.now() / 1000) - 60,
    f107: 116,
  })
  assert.ok(quote)
  assert.equal(quote.latestPrice, 230)
  assert.equal(quote.previousClose, 228)
})

test('东财：费城半导体指数（f107=251）按 10^2 除、市场名「指数」', () => {
  const quote = normalizeEastmoneyQuote('251.SOX', {
    f57: 'SOX',
    f58: '费城半导体指数',
    f43: 1186839,
    f60: 1262100,
    f169: -75261,
    f170: -596,
    f152: 2,
    f86: Math.floor(Date.now() / 1000) - 60,
    f107: 251,
  })
  assert.ok(quote)
  assert.equal(quote.latestPrice, 11868.39)
  assert.equal(quote.previousClose, 12621)
  assert.equal(quote.change, -752.61)
  assert.equal(quote.changePercent, -5.96)
  assert.equal(quote.marketName, '指数')
  assert.equal(quote.isStale, false)
})

test('东财：f57/f58 为空视为行情为空', () => {
  assert.equal(normalizeEastmoneyQuote('105.QQQ', null), null)
  assert.equal(normalizeEastmoneyQuote('105.QQQ', { f57: '', f58: 'x' }), null)
  assert.equal(normalizeEastmoneyQuote('105.QQQ', { f57: 'QQQ', f58: '' }), null)
})

test('东财：时间戳缺失或距今 >4h 视为 stale', () => {
  const stale = normalizeEastmoneyQuote('105.QQQ', {
    f57: 'QQQ',
    f58: 'x',
    f43: 500,
    f86: Math.floor(Date.now() / 1000) - 5 * 3600,
  })
  assert.ok(stale)
  assert.equal(stale.isStale, true)

  const noTime = normalizeEastmoneyQuote('105.QQQ', { f57: 'QQQ', f58: 'x', f43: 500 })
  assert.ok(noTime)
  assert.equal(noTime.isStale, true)
})

test('东财：价格除数规则', () => {
  assert.equal(priceDivisor(undefined, undefined), 100)
  assert.equal(priceDivisor(3, 105), 1000)
  assert.equal(priceDivisor(0, 116), 1000)
})

// ---------------------------------------------------------------------------
// 时间解析
// ---------------------------------------------------------------------------

test('行情时间：支持 数字秒/毫秒、yyyyMMddHHmmss、yyyy-MM-dd HH:mm:ss', () => {
  assert.equal(parseQuoteTime('20260817153000'), '2026-08-17 15:30:00')
  assert.equal(parseQuoteTime('2026-08-17 15:30:00'), '2026-08-17 15:30:00')
  assert.equal(parseQuoteTime('2026-08-17 15:30'), '2026-08-17 15:30:00')
  assert.equal(parseQuoteTime(''), '')
  // 14 位 20xx 开头必须是紧凑时间，不能被当成毫秒时间戳
  assert.equal(parseQuoteTime('20260817153000'), '2026-08-17 15:30:00')
})

test('quoteTimeToDate 可解析紧凑时间 / ISO 时间 / 秒与毫秒时间戳', () => {
  const compact = quoteTimeToDate('20260817153000')
  assert.ok(compact)
  assert.equal(compact.getHours(), 15)
  assert.equal(compact.getMinutes(), 30)
  const iso = quoteTimeToDate('2026-08-17 15:30:00')
  assert.ok(iso)
  assert.equal(iso.getFullYear(), 2026)
  assert.equal(quoteTimeToDate('1728000000')?.getTime(), 1728000000000) // 秒 → 毫秒
  assert.equal(quoteTimeToDate('1728000000000')?.getTime(), 1728000000000) // 毫秒原样
  assert.equal(quoteTimeToDate('not-a-time'), null)
})

// ---------------------------------------------------------------------------
// 校验 / 展示名
// ---------------------------------------------------------------------------

test('validateQuote 区间校验', () => {
  assert.equal(validateQuote(100, 50, 200), true)
  assert.equal(validateQuote(10, 50, 200), false)
  assert.equal(validateQuote(300, 50, 200), false)
  assert.equal(validateQuote(null, 50, 200), false)
})

test('isAbnormalPct：|pct| >= 80 为异常，null 不算', () => {
  assert.equal(isAbnormalPct(80), true)
  assert.equal(isAbnormalPct(-90), true)
  assert.equal(isAbnormalPct(12), false)
  assert.equal(isAbnormalPct(null), false)
})

test('displayName：乱码 / 空值回退配置名', () => {
  assert.equal(displayName(undefined, '黄金'), '黄金')
  assert.equal(displayName('', '黄金'), '黄金')
  assert.equal(displayName('pv_none_match', '黄金'), '黄金')
  assert.equal(displayName('上证指数', '兜底'), '上证指数')
  assert.equal(displayName('AAPL', '兜底'), 'AAPL')
})

// ---------------------------------------------------------------------------
// ⑤ 跳转小程序配置解析
// ---------------------------------------------------------------------------

test('跳转配置：data.jumpMp 优先，appId 校验通过才可见', () => {
  const config = parseJumpMpBody({
    jumpMp: {
      show: true,
      appId: 'wx1234567890abcdef',
      title: '看有色',
      desc: '金银行情',
      actionText: '去看看',
      path: '/pages/x',
      envVersion: 'trial',
    },
  })
  assert.equal(config.visible, true)
  assert.equal(config.appId, 'wx1234567890abcdef')
  assert.equal(config.envVersion, 'trial')
  assert.equal(config.actionText, '去看看')
})

test('跳转配置：data.more.jumpMp 与 data 本身兜底', () => {
  const viaMore = parseJumpMpBody({ more: { jumpMp: { show: 1, appId: 'wx1234567890abcdef' } } })
  assert.equal(viaMore.visible, true)

  const viaSelf = parseJumpMpBody({ show: 'true', appId: 'wx1234567890abcdef' })
  assert.equal(viaSelf.visible, true)
})

test('跳转配置：appId 含占位文案 / 格式非法则不可见', () => {
  const placeholder = parseJumpMpBody({ jumpMp: { show: true, appId: '填写你的appid' } })
  assert.equal(placeholder.visible, false)
  assert.equal(placeholder.appId, '')

  const invalid = parseJumpMpBody({ jumpMp: { show: true, appId: 'wx123' } })
  assert.equal(invalid.visible, false)
})

test('跳转配置：字符串响应去掉 BOM 后解析，失败回默认隐藏配置', () => {
  const config = parseJumpMpBody('\uFEFF{"jumpMp":{"show":"yes","appId":"wx1234567890abcdef"}}')
  assert.equal(config.visible, true)
  const broken = parseJumpMpBody('not-json{')
  assert.equal(broken.visible, false)
  assert.equal(broken.title, '看有色金属行情 金价魔方小程序')
})

// ---------------------------------------------------------------------------
// 多源聚合工具
// ---------------------------------------------------------------------------

test('bareCode / aShareSecid 代码规则', () => {
  assert.equal(bareCode('105.NVDA'), 'NVDA')
  assert.equal(bareCode('NVDA'), 'NVDA')
  assert.equal(aShareSecid('sh600519'), '1.600519')
  assert.equal(aShareSecid('sz000001'), '0.000001')
})

test('similarQuotes：绝对差 / 相对差 / 涨跌幅差任一在容差内即相似', () => {
  const tols = { relTol: 0.01, absTol: 0.02, pctTol: 0.5 }
  const a: SourceQuote = {
    price: 100,
    previousClose: 99,
    change: 1,
    changePercent: 1,
    source: 'sina',
  }
  const b: SourceQuote = {
    price: 100.005,
    previousClose: 99,
    change: 1.005,
    changePercent: 1.01,
    source: 'tencent',
  }
  const c: SourceQuote = {
    price: 150,
    previousClose: 149,
    change: 1,
    changePercent: 2.0,
    source: 'em',
  }
  assert.equal(similarQuotes(a, b, tols), true)
  assert.equal(similarQuotes(a, c, tols), false)
})

test('findConsensus：相似组取中位数，组数 <2 返回 null', () => {
  const tols = { relTol: 0.01, absTol: 0.02, pctTol: 0.5 }
  const group: SourceQuote[] = [
    { price: 100, previousClose: 99, change: 1, changePercent: 1, source: 'sina' },
    { price: 100.01, previousClose: 99, change: 1.01, changePercent: 1.01, source: 'tencent' },
    { price: 150, previousClose: 149, change: 1, changePercent: 2.0, source: 'em' },
  ]
  const consensus = findConsensus(group, tols)
  assert.ok(consensus)
  assert.ok(Math.abs((consensus.price as number) - 100.005) < 0.001)
  assert.equal(findConsensus([group[0] as SourceQuote], tols), null)
})

// ---------------------------------------------------------------------------
// 市场会话（docs 5.2）
// ---------------------------------------------------------------------------

test('A股阶段：北京时间为准（UTC+8）', () => {
  // 2026-03-10 周二 09:40 北京时间
  assert.equal(getAStockPhase(new Date(Date.UTC(2026, 2, 10, 1, 40))), 'morning')
  // 2026-03-10 12:00 北京时间 = 午休
  assert.equal(getAStockPhase(new Date(Date.UTC(2026, 2, 10, 4, 0))), 'lunch')
  // 2026-03-14 周六
  assert.equal(getAStockPhase(new Date(Date.UTC(2026, 2, 14, 2, 0))), 'closed')
})

test('美东夏令时：3 月第二个周日 ~ 11 月第一个周日', () => {
  assert.equal(isUsDst(new Date(Date.UTC(2026, 2, 7))), false)
  assert.equal(isUsDst(new Date(Date.UTC(2026, 2, 8))), true)
  assert.equal(isUsDst(new Date(Date.UTC(2026, 9, 31))), true)
  assert.equal(isUsDst(new Date(Date.UTC(2026, 10, 1))), false)
})

test('美股阶段：美东时间 09:30-16:00 盘中', () => {
  // 2026-03-09 周一 13:30 UTC = 09:30 ET（夏令时）
  assert.equal(getUsPhase(new Date(Date.UTC(2026, 2, 9, 13, 30))), 'regular')
  // 20:00 UTC = 16:00 ET → 盘后
  assert.equal(getUsPhase(new Date(Date.UTC(2026, 2, 9, 20, 0))), 'post')
})

test('getMarketSession：A股盘中时 useA=true', () => {
  const session = getMarketSession(new Date(Date.UTC(2026, 2, 10, 1, 40))) // 北京周二 09:40
  assert.equal(session.useA, true)
  assert.equal(session.statusTone, 'active')
  assert.ok(session.label.includes('A股盘中'))
})

test('stripTrailingZeros 与 formatNumber/formatChange 格式化清洗测试', async () => {
  const { stripTrailingZeros, formatNumber, formatChange } = await import('../utils/formatter')
  assert.equal(stripTrailingZeros('1.00 00'), '1')
  assert.equal(stripTrailingZeros('1.50'), '1.5')
  assert.equal(stripTrailingZeros('1.23'), '1.23')

  assert.equal(formatNumber(1.0), '1')
  assert.equal(formatNumber(1.5), '1.5')
  assert.equal(formatNumber(1.23), '1.23')
  assert.equal(formatNumber(100.0), '100')

  assert.equal(formatChange(0.0), '0%')
  assert.equal(formatChange(1.5), '+1.5%')
  assert.equal(formatChange(1.0), '+1%')
})
