/**
 * 分时页多源优先级框架（config/minute.ts 的 resolveMinutePlan / resolveMinuteQuotePlan）
 * 与「按顺序从前到后兜底」的契约校验（纯配置 + 纯函数，不发起网络请求）。
 *
 * 背景：分时页改为「每个 code 可配源优先级」，缺省 腾讯 → 东财 → Yahoo；
 * 基础信息报价缺省 腾讯快照 qt.gtimg.cn → 东财 ulist。配置里只声明标识与顺序，
 * 未配置标识的源自动跳过（如期货/商品/外汇/板块没有腾讯代码 → 计划里只有东财）。
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import {
  DEFAULT_MINUTE_PRIORITY,
  DEFAULT_MINUTE_QUOTE_PRIORITY,
  MINUTE_SOURCES,
  resolveMinutePlan,
  resolveMinuteQuotePlan,
  resolveMinuteSources,
  usTcCodeOfSecid,
} from '../config/minute.ts'
import { INDUSTRY_BOARDS } from '../config/tabbar.ts'

// ---------------------------------------------------------------------------
// 东财美股 secid → 腾讯代码（实测：腾讯美股份时/快照代码不带 .OQ/.N 后缀，下划线还原为点）
// ---------------------------------------------------------------------------

test('usTcCodeOfSecid：105.NVDA → usNVDA、106.BRK_B → usBRK.B', () => {
  assert.equal(usTcCodeOfSecid('105.NVDA'), 'usNVDA')
  assert.equal(usTcCodeOfSecid('106.JPM'), 'usJPM')
  assert.equal(usTcCodeOfSecid('107.BATT'), 'usBATT')
  // 伯克希尔 B：东财 secid 用下划线（BRK_B），腾讯行情代码用点（usBRK.B）
  assert.equal(usTcCodeOfSecid('106.BRK_B'), 'usBRK.B')
})

test('resolveMinuteSources：美股个股未登记时同时给出东财与腾讯源（供优先级计划展开）', () => {
  assert.deepEqual(resolveMinuteSources('105.NVDA'), { em: '105.NVDA', tc: 'usNVDA' })
  assert.deepEqual(resolveMinuteSources('106.BRK_B'), { em: '106.BRK_B', tc: 'usBRK.B' })
})

// ---------------------------------------------------------------------------
// 分时序列计划：默认顺序 腾讯 → 东财 → Yahoo，未配置标识的源自动跳过
// ---------------------------------------------------------------------------

test('resolveMinutePlan：A股指数按「腾讯 → 东财」展开（腾讯优先，东财兜底）', () => {
  const plan = resolveMinutePlan('sh000001')
  assert.deepEqual(plan.steps, [
    { kind: 'tencent', tc: 'sh000001' },
    { kind: 'eastmoney', secid: '1.000001' },
  ])
})

test('resolveMinutePlan：A股个股兜底路径同样腾讯优先', () => {
  assert.deepEqual(resolveMinutePlan('sh600519').steps, [
    { kind: 'tencent', tc: 'sh600519' },
    { kind: 'eastmoney', secid: '1.600519' },
  ])
})

test('resolveMinutePlan：只有东财源的标的（期货/商品/板块/平均股价）计划里没有腾讯', () => {
  // 有色页黄金 → 沪金主连（腾讯不覆盖期货，配置里没有 tc）
  assert.deepEqual(resolveMinutePlan('GOLD').steps, [{ kind: 'eastmoney', secid: '113.aum' }])
  // 东财板块指数
  assert.deepEqual(resolveMinutePlan('BK1134').steps, [{ kind: 'eastmoney', secid: '90.BK1134' }])
  // A股平均股价（腾讯 sh880003 无分时）
  assert.deepEqual(resolveMinutePlan('AVG').steps, [{ kind: 'eastmoney', secid: '47.800005' }])
})

test('resolveMinutePlan：境外标的按「东财 → Yahoo」展开（腾讯对日韩/汇率无有效分时）', () => {
  assert.deepEqual(resolveMinutePlan('005930').steps, [
    { kind: 'eastmoney', secid: '177.005930' },
    { kind: 'yahoo', symbol: '005930.KS' },
  ])
  assert.deepEqual(resolveMinutePlan('USDJPY').steps, [
    { kind: 'eastmoney', secid: '119.USDJPY' },
    { kind: 'yahoo', symbol: 'JPY=X' },
  ])
})

test('resolveMinutePlan：美股指数/ETF 补上腾讯源（usDJI / usINX / usIXIC / usTLT）', () => {
  assert.deepEqual(resolveMinutePlan('usDJI').steps, [
    { kind: 'tencent', tc: 'usDJI' },
    { kind: 'eastmoney', secid: '100.DJIA' },
  ])
  assert.deepEqual(resolveMinutePlan('TLT').steps, [
    { kind: 'tencent', tc: 'usTLT' },
    { kind: 'eastmoney', secid: '105.TLT' },
  ])
})

test('resolveMinutePlan：合成源（代理股均值 / 交叉汇率）为计划中的一步且带 note', () => {
  const board = resolveMinutePlan('us-BK1134')
  assert.equal(board.steps.length, 1)
  assert.equal(board.steps[0]?.kind, 'emProxies')
  // 代理列表与卡片侧 INDUSTRY_BOARDS 单一数据源保持一致（us-BK1134 = AI算力）
  const aiBoard = INDUSTRY_BOARDS.find((item) => item.code === 'BK1134')
  assert.deepEqual(board.steps[0]?.proxies, aiBoard?.proxies)

  const cross = resolveMinutePlan('CNYKRW')
  assert.equal(cross.steps[0]?.kind, 'emCross')
  assert.deepEqual(cross.steps[0]?.cross, {
    numerator: '119.USDKRW',
    denominator: '133.USDCNH',
  })
  assert.ok(cross.note, 'CNYKRW 应带口径提示')
})

test('resolveMinutePlan：未登记的无源 code 返回空计划', () => {
  assert.deepEqual(resolveMinutePlan('KQ11').steps, [])
  assert.deepEqual(resolveMinutePlan('TPX').steps, [])
  assert.deepEqual(resolveMinutePlan('VIX').steps, [])
  assert.deepEqual(resolveMinutePlan('__proto__').steps, [])
})

test('resolveMinutePlan：priority 可按 code 覆盖默认顺序（从后往前示例：东财优先）', () => {
  // 通过临时替换配置验证框架本身（不依赖具体标的后期的配置调整）
  const original = MINUTE_SOURCES.sh600519PROBE
  MINUTE_SOURCES.sh600519PROBE = {
    em: '1.600519',
    tc: 'sh600519',
    priority: ['eastmoney', 'tencent'],
  }
  try {
    assert.deepEqual(resolveMinutePlan('sh600519PROBE').steps, [
      { kind: 'eastmoney', secid: '1.600519' },
      { kind: 'tencent', tc: 'sh600519' },
    ])
  } finally {
    if (original === undefined) delete MINUTE_SOURCES.sh600519PROBE
    else MINUTE_SOURCES.sh600519PROBE = original
  }
})

test('resolveMinutePlan：priority 里配置了但缺标识的源不会进入计划', () => {
  const original = MINUTE_SOURCES.sh600519PROBE2
  MINUTE_SOURCES.sh600519PROBE2 = {
    em: '1.600519',
    priority: ['tencent', 'eastmoney', 'yahoo'],
  }
  try {
    // 未配 tc / yahoo → 只剩东财一步
    assert.deepEqual(resolveMinutePlan('sh600519PROBE2').steps, [
      { kind: 'eastmoney', secid: '1.600519' },
    ])
  } finally {
    if (original === undefined) delete MINUTE_SOURCES.sh600519PROBE2
    else MINUTE_SOURCES.sh600519PROBE2 = original
  }
})

// ---------------------------------------------------------------------------
// 基础信息报价计划：默认 腾讯快照 qt.gtimg.cn → 东财 ulist
// ---------------------------------------------------------------------------

test('resolveMinuteQuotePlan：缺省「腾讯 → 东财」，与 DEFAULT_MINUTE_QUOTE_PRIORITY 一致', () => {
  assert.deepEqual(DEFAULT_MINUTE_QUOTE_PRIORITY, ['tencent', 'eastmoney'])
  assert.deepEqual(resolveMinuteQuotePlan('sh600519'), [
    { kind: 'tencent', tc: 'sh600519' },
    { kind: 'eastmoney', secid: '1.600519' },
  ])
})

test('resolveMinuteQuotePlan：无腾讯代码的标的只用东财 ulist', () => {
  assert.deepEqual(resolveMinuteQuotePlan('GOLD'), [{ kind: 'eastmoney', secid: '113.aum' }])
  assert.deepEqual(resolveMinuteQuotePlan('GC'), [{ kind: 'eastmoney', secid: '122.XAU' }])
})

test('resolveMinuteQuotePlan：quotePriority 可按 code 覆盖（东财优先、腾讯兜底）', () => {
  const original = MINUTE_SOURCES.usDJIPROBE
  MINUTE_SOURCES.usDJIPROBE = {
    tc: 'usDJI',
    em: '100.DJIA',
    quotePriority: ['eastmoney', 'tencent'],
  }
  try {
    assert.deepEqual(resolveMinuteQuotePlan('usDJIPROBE'), [
      { kind: 'eastmoney', secid: '100.DJIA' },
      { kind: 'tencent', tc: 'usDJI' },
    ])
  } finally {
    if (original === undefined) delete MINUTE_SOURCES.usDJIPROBE
    else MINUTE_SOURCES.usDJIPROBE = original
  }
})

test('默认优先级常量：分时 腾讯 → 东财 → Yahoo → 合成源', () => {
  assert.deepEqual(DEFAULT_MINUTE_PRIORITY, [
    'tencent',
    'eastmoney',
    'yahoo',
    'emProxies',
    'emCross',
  ])
})
