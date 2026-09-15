import assert from 'node:assert/strict'
import test from 'node:test'

import { klineApi } from '../api/kline.ts'
import { hasKlineSources, resolveKlineSources } from '../config/kline.ts'
import { MINUTE_SOURCES } from '../config/minute.ts'
import { clearKlineCache, fetchKlineSeries } from '../utils/kline-source.ts'
import type { KlinePoint } from '../types/stock.ts'

const originalTencent = klineApi.tencent
const originalSina = klineApi.sina
const originalEastmoney = klineApi.eastmoney

/** 生成 n 根**连续日期**的日 K（跨月跨年，保证能聚合出周 / 月 / 年线） */
function bars(n: number): KlinePoint[] {
  const result: KlinePoint[] = []
  const cursor = new Date(Date.UTC(2019, 0, 2))
  for (let i = 0; i < n; i += 1) {
    const y = cursor.getUTCFullYear()
    const m = String(cursor.getUTCMonth() + 1).padStart(2, '0')
    const d = String(cursor.getUTCDate()).padStart(2, '0')
    result.push({
      time: `${y}-${m}-${d}`,
      open: 10,
      close: 11,
      high: 12,
      low: 9,
      volume: 100,
    })
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }
  return result
}

/** 生成 n 根连续日期日 K，收盘价按 (base + i * step) 递增（用于验证归一化均值合成） */
function rampedBars(n: number, base: number, step: number): KlinePoint[] {
  return bars(n).map((bar, i) => {
    const close = base + i * step
    return { ...bar, open: close, close, high: close, low: close, volume: 0 }
  })
}

/** 生成 n 根**按月间隔**的 K 线（用于验证年 K 由月线聚合） */
function monthlyBars(n: number): KlinePoint[] {
  const result: KlinePoint[] = []
  let year = 2019
  let month = 1
  for (let i = 0; i < n; i += 1) {
    result.push({
      time: `${year}-${String(month).padStart(2, '0')}-01`,
      open: 10,
      close: 11,
      high: 12,
      low: 9,
      volume: 100,
    })
    month += 1
    if (month > 12) {
      month = 1
      year += 1
    }
  }
  return result
}

interface StubLog {
  tencent: string[]
  sina: string[]
  eastmoney: string[]
}

function newLog(): StubLog {
  return { tencent: [], sina: [], eastmoney: [] }
}

/** 安装桩：按 (code, unit) 决定返回数据，记录调用序列 */
function installStub(
  log: StubLog,
  handler: {
    tencent?: (code: string, unit: string) => KlinePoint[] | null
    sina?: (kind: string, symbol: string, unit: string) => KlinePoint[] | null
    eastmoney?: (secid: string, unit: string) => KlinePoint[] | null
  },
): void {
  klineApi.tencent = async (code, unit) => {
    log.tencent.push(`${code}:${unit}`)
    return handler.tencent ? handler.tencent(code, unit) : null
  }
  klineApi.sina = async (kind: string, symbol: string, unit = 'day') => {
    log.sina.push(`${kind}:${symbol}:${unit}`)
    return handler.sina ? handler.sina(kind, symbol, unit) : null
  }
  klineApi.eastmoney = async (secid, unit) => {
    log.eastmoney.push(`${secid}:${unit}`)
    return handler.eastmoney ? handler.eastmoney(secid, unit) : null
  }
}

function restore(): void {
  klineApi.tencent = originalTencent
  klineApi.sina = originalSina
  klineApi.eastmoney = originalEastmoney
  clearKlineCache()
}

// ---------------------------------------------------------------------------
// 代码 → 数据源映射
// ---------------------------------------------------------------------------

test('resolveKlineSources：显式登记标的（指数 / 期货 / 汇率 / 外盘）命中对应源', () => {
  const shIndex = resolveKlineSources('sh000001')
  assert.deepEqual(shIndex?.tc, ['sh000001'])
  assert.equal(shIndex?.sina?.kind, 'ashare')

  // 有色页沪金主连：新浪内盘期货
  assert.equal(resolveKlineSources('GOLD')?.sina?.symbol, 'AU0')
  // 宏观外盘：新浪外盘期货 + 口径提示
  assert.equal(resolveKlineSources('BRT')?.sina?.kind, 'futuresGlobal')
  assert.ok(resolveKlineSources('GC')?.note?.includes('COMEX'))
  // 汇率：腾讯 wh 前缀 / 新浪外汇
  assert.deepEqual(resolveKlineSources('USDJPY')?.tc, ['whUSDJPY'])
  assert.equal(resolveKlineSources('USDKRW')?.sina?.symbol, 'USDKRW')
  // 美元指数：腾讯 whDINIW 优先，usUDI 作第二候选
  assert.deepEqual(resolveKlineSources('UDI')?.tc, ['whDINIW', 'usUDI'])
})

test('resolveKlineSources：个股走正则兜底（A股 / 美股后缀探测 / 日韩市场前缀）', () => {
  const aShare = resolveKlineSources('sh600519')
  assert.deepEqual(aShare?.tc, ['sh600519'])
  assert.equal(aShare?.sina?.week, true, 'A股支持新浪周线 scale=1680')

  const emAShare = resolveKlineSources('1.600549')
  assert.deepEqual(emAShare?.tc, ['sh600549'], '东财 secid 转腾讯代码')
  const emShenzhen = resolveKlineSources('0.002428')
  assert.deepEqual(emShenzhen?.tc, ['sz002428'])

  const usStock = resolveKlineSources('105.NVDA')
  assert.deepEqual(
    usStock?.tc,
    ['usNVDA.OQ', 'usNVDA.N', 'usNVDA.A'],
    '美股按 纳指/纽交/美交 顺序探测',
  )
  assert.equal(usStock?.sina?.symbol, 'NVDA')

  // 日韩个股：按分时配置的东财市场号判定腾讯前缀（韩股 6 位、日股 4 位裸代码）
  assert.deepEqual(resolveKlineSources('005930')?.tc, ['kr005930'])
  assert.deepEqual(resolveKlineSources('7203')?.tc, ['jp7203'])
  assert.deepEqual(resolveKlineSources('8035')?.tc, ['jp8035'])
})

test('resolveKlineSources：东财源覆盖腾讯 / 新浪都没有的标的（板块指数 / 国际指数 / 平均股价）', () => {
  // A股板块指数：东财 90.BKxxxx（与卡片报价、分时同一 secid）
  assert.equal(resolveKlineSources('BK1134')?.em, '90.BK1134')
  assert.equal(resolveKlineSources('BK1626')?.em, '90.BK1626')
  // 平均股价（东财自编指数）与费半：只有东财，费半另有新浪兜底
  assert.equal(resolveKlineSources('AVG')?.em, '47.800005')
  assert.equal(resolveKlineSources('SOX')?.em, '251.SOX')
  assert.equal(resolveKlineSources('SOX')?.sina?.symbol, '.SOX')
  // 日韩与越南 / 印度指数：腾讯 krKOSPI / jpN225 均 param error，只走东财
  assert.equal(resolveKlineSources('KS11')?.em, '100.KS11')
  assert.equal(resolveKlineSources('N225')?.em, '100.N225')
  assert.equal(resolveKlineSources('N225')?.sina?.symbol, 'NK', '日经225 兜底为新浪外盘期货连续')
  assert.equal(resolveKlineSources('VNINDEX')?.em, '100.VNINDEX')
  assert.equal(resolveKlineSources('SENSEX')?.em, '100.SENSEX')
})

test('resolveKlineSources：合成标的（美股板块代理股均值 / 交叉汇率两腿相除）', () => {
  // 美股时段板块：代理股清单与 INDUSTRY_BOARDS 一致（与卡片、分时同口径）
  const usBoard = resolveKlineSources('us-BK1134')
  assert.deepEqual(usBoard?.proxies, ['105.NVDA', '105.AMD', '105.AVGO', '105.MRVL', '105.SMCI'])
  assert.equal(usBoard?.tc, undefined, '美股板块不再走单标的腾讯源')
  for (const code of ['us-BK1134', 'us-BK0917', 'us-BK1626']) {
    assert.ok(resolveKlineSources(code)?.proxies?.length, `${code} 应有代理股清单`)
  }
  // 交叉汇率：两腿均为新浪外汇日线
  const krw = resolveKlineSources('CNYKRW')?.cross
  assert.equal(krw?.numerator?.sina?.symbol, 'USDKRW')
  assert.equal(krw?.denominator?.sina?.symbol, 'USDCNH')
  const jpy = resolveKlineSources('CNYJPY')?.cross
  assert.equal(jpy?.numerator?.sina?.symbol, 'USDJPY')
  assert.equal(jpy?.denominator?.sina?.symbol, 'USDCNH')
})

test('resolveKlineSources：真正无源的标的仍返回 null，原型链属性名不被误判', () => {
  // 这些标的分时本身也没有源（不在 MINUTE_SOURCES 中），K 线同样为空
  for (const code of ['VIX', 'KOSDAQ', 'TOPIX', 'us-BK9999']) {
    assert.equal(resolveKlineSources(code), null, `${code} 应无 K 线源`)
    assert.equal(hasKlineSources(code), false)
  }
  assert.equal(resolveKlineSources('toString'), null)
  assert.equal(resolveKlineSources('__proto__'), null)
})

test('覆盖度：分时配置里的每个标的都必须有 K 线源（新增漏配直接失败）', () => {
  const missing: string[] = []
  for (const code of Object.keys(MINUTE_SOURCES)) {
    if (!hasKlineSources(code)) missing.push(code)
  }
  assert.deepEqual(missing, [], `以下标的在分时配置中存在但未登记 K 线源：${missing.join(', ')}`)
})

// ---------------------------------------------------------------------------
// 兜底链与聚合
// ---------------------------------------------------------------------------

test('日 K：腾讯命中即返回，不再请求新浪', async (t) => {
  t.after(restore)
  const log = newLog()
  installStub(log, { tencent: (_code, unit) => (unit === 'day' ? bars(30) : null) })
  const result = await fetchKlineSeries('sh600519', 'day')
  assert.ok(result)
  assert.equal(result.klines.length, 30)
  assert.equal(result.sourceLabel, '腾讯K线')
  assert.equal(result.aggregated, false)
  assert.deepEqual(log.tencent, ['sh600519:day'])
  assert.deepEqual(log.sina, [], '腾讯已命中，不再请求新浪')
})

test('周 K：腾讯周线返回 1 根（不足）时回退日 K 聚合，并标注聚合口径', async (t) => {
  t.after(restore)
  const log = newLog()
  installStub(log, {
    tencent: (_code, unit) => {
      if (unit === 'week') return bars(1)
      if (unit === 'day') return bars(60)
      return null
    },
  })
  const result = await fetchKlineSeries('005930', 'week')
  assert.ok(result)
  assert.equal(result.aggregated, true)
  assert.ok(result.sourceLabel.includes('周K聚合'), result.sourceLabel)
  assert.ok(result.klines.length >= 2)
  assert.deepEqual(log.tencent, ['kr005930:week', 'kr005930:day'])
})

test('月 K：腾讯月线缺失 → 周线聚合；周线也缺失 → 日线聚合', async (t) => {
  t.after(restore)
  const log = newLog()
  installStub(log, {
    tencent: (_code, unit) => (unit === 'week' ? bars(60) : null),
  })
  const monthly = await fetchKlineSeries('sh600519', 'month')
  assert.ok(monthly)
  assert.ok(monthly.sourceLabel.includes('月K聚合'))
  assert.deepEqual(log.tencent, ['sh600519:month', 'sh600519:week'])
})

test('年 K：恒为聚合结果（无直连源），失败链按 月→周→日 顺序回退', async (t) => {
  t.after(restore)
  const log = newLog()
  installStub(log, {
    tencent: (_code, unit) => (unit === 'day' ? bars(400) : null),
  })
  const yearly = await fetchKlineSeries('sh600519', 'year')
  assert.ok(yearly)
  assert.equal(yearly.aggregated, true)
  assert.ok(yearly.sourceLabel.includes('年K聚合'), yearly.sourceLabel)
  assert.ok(yearly.klines.length >= 1)
  assert.deepEqual(log.tencent, ['sh600519:month', 'sh600519:week', 'sh600519:day'])
})

test('多源兜底：腾讯全失败时改用新浪（A股 kind=ashare，周线带 scale=1680 语义）', async (t) => {
  t.after(restore)
  const log = newLog()
  installStub(log, {
    tencent: () => null,
    sina: (kind, symbol, unit) => (kind === 'ashare' && unit === 'day' ? bars(40) : null),
  })
  const result = await fetchKlineSeries('sh600519', 'day')
  assert.ok(result)
  assert.equal(result.sourceLabel, '新浪K线')
  assert.deepEqual(log.sina, ['ashare:sh600519:day'])
})

test('新浪日线（期货 / 外汇仅有日线）：周 / 月 / 年全部由日线聚合', async (t) => {
  t.after(restore)
  const log = newLog()
  installStub(log, {
    tencent: () => null,
    sina: () => bars(400),
  })
  const monthly = await fetchKlineSeries('GOLD', 'month')
  assert.ok(monthly)
  assert.equal(monthly.aggregated, true)
  assert.ok(monthly.sourceLabel.includes('新浪K线'))
  assert.ok(
    log.sina.every((call) => call.includes(':day')),
    '新浪期货源只请求日线',
  )
})

test('美股后缀探测：首个候选失败后命中第二个，且后续请求只打命中代码（含缓存）', async (t) => {
  t.after(restore)
  const log = newLog()
  installStub(log, {
    tencent: (code) => (code === 'usNVDA.N' ? bars(40) : null),
  })
  const first = await fetchKlineSeries('105.NVDA', 'day')
  assert.ok(first)
  assert.deepEqual(log.tencent, ['usNVDA.OQ:day', 'usNVDA.N:day'])

  // 同一周期：命中 60s 缓存，不再请求
  log.tencent.length = 0
  const cached = await fetchKlineSeries('105.NVDA', 'day')
  assert.equal(cached?.klines.length, 40)
  assert.deepEqual(log.tencent, [], '命中缓存不重复请求')

  // 换周期：已探明的代码优先，不再回落到失败候选
  log.tencent.length = 0
  await fetchKlineSeries('105.NVDA', 'month')
  assert.deepEqual(log.tencent, ['usNVDA.N:month'])
})

test('无源标的：不发任何请求直接返回 null；clearKlineCache 后重新取数', async (t) => {
  t.after(restore)
  const log = newLog()
  installStub(log, { tencent: () => bars(30), sina: () => bars(30), eastmoney: () => bars(30) })
  assert.equal(await fetchKlineSeries('KOSDAQ', 'day'), null)
  assert.deepEqual(log.tencent, [])
  assert.deepEqual(log.sina, [])
  assert.deepEqual(log.eastmoney, [])

  await fetchKlineSeries('sh600519', 'day')
  assert.equal(log.tencent.length, 1)
  clearKlineCache('sh600519')
  await fetchKlineSeries('sh600519', 'day')
  assert.equal(log.tencent.length, 2, '清缓存后重新请求')
})

test('全部源失败：返回 null（页面展示「该周期暂无数据」），不抛错', async (t) => {
  t.after(restore)
  const log = newLog()
  installStub(log, { tencent: () => null, sina: () => null, eastmoney: () => null })
  assert.equal(await fetchKlineSeries('sh600519', 'day'), null)
  assert.equal(await fetchKlineSeries('sh600519', 'year'), null)
  // A股板块：只有东财一个源，东财失败即空态，且不会去请求腾讯 / 新浪
  assert.equal(await fetchKlineSeries('BK1134', 'day'), null)
  assert.deepEqual(log.eastmoney, ['90.BK1134:day'])
  assert.deepEqual(log.tencent, ['sh600519:day', 'sh600519:month', 'sh600519:week', 'sh600519:day'])
  assert.ok(
    log.sina.every((call) => call.includes('sh600519')),
    `板块不应请求腾讯 / 新浪：${log.sina.join(', ')}`,
  )
})

// ---------------------------------------------------------------------------
// 东财源（板块指数 / 国际指数 / 平均股价）
// ---------------------------------------------------------------------------

test('东财日 K：命中即返回，不再请求腾讯 / 新浪', async (t) => {
  t.after(restore)
  const log = newLog()
  installStub(log, {
    eastmoney: (secid, unit) => (secid === '90.BK1134' && unit === 'day' ? bars(60) : null),
    tencent: () => bars(60),
    sina: () => bars(60),
  })
  const result = await fetchKlineSeries('BK1134', 'day')
  assert.ok(result)
  assert.equal(result.klines.length, 60)
  assert.equal(result.sourceLabel, '东方财富K线')
  assert.equal(result.aggregated, false)
  assert.deepEqual(log.eastmoney, ['90.BK1134:day'])
  assert.deepEqual(log.tencent, [], '东财已命中，不再请求腾讯')
  assert.deepEqual(log.sina, [])
})

test('东财失败：有新浪兜底的标的（费半 SOX）自动降级，无兜底的（板块）返回空态', async (t) => {
  t.after(restore)
  const log = newLog()
  installStub(log, {
    eastmoney: () => null,
    sina: (kind, symbol) => (kind === 'us' && symbol === '.SOX' ? bars(40) : null),
  })
  const sox = await fetchKlineSeries('SOX', 'day')
  assert.ok(sox)
  assert.equal(sox.sourceLabel, '新浪K线')
  assert.deepEqual(log.eastmoney, ['251.SOX:day'])
  assert.deepEqual(log.sina, ['us:.SOX:day'])

  log.eastmoney.length = 0
  log.sina.length = 0
  assert.equal(await fetchKlineSeries('KS11', 'day'), null)
  assert.deepEqual(log.eastmoney, ['100.KS11:day'])
  assert.deepEqual(log.sina, [])
})

test('东财周 / 月线直取，年 K 由月线聚合（与腾讯链路一致）', async (t) => {
  t.after(restore)
  const log = newLog()
  installStub(log, {
    eastmoney: (secid, unit) =>
      secid === '100.N225' ? (unit === 'month' ? monthlyBars(36) : bars(60)) : null,
  })
  const weekly = await fetchKlineSeries('N225', 'week')
  assert.ok(weekly)
  assert.equal(weekly.aggregated, false)
  assert.deepEqual(log.eastmoney, ['100.N225:week'])

  log.eastmoney.length = 0
  const yearly = await fetchKlineSeries('N225', 'year')
  assert.ok(yearly)
  assert.equal(yearly.aggregated, true)
  assert.ok(yearly.sourceLabel.includes('年K聚合'), yearly.sourceLabel)
  assert.equal(yearly.klines.length, 3, '36 根月线聚合为 3 根年线')
  assert.deepEqual(log.eastmoney, ['100.N225:month'])
})

// ---------------------------------------------------------------------------
// 合成标的（美股板块代理股均值 / 交叉汇率两腿相除）
// ---------------------------------------------------------------------------

test('美股板块日 K：代理股按基准日归一化到 100 后取等权均值（口径与卡片一致）', async (t) => {
  t.after(restore)
  const log = newLog()
  installStub(log, {
    // 两只代理价格水位不同（10 递增 1 / 20 递增 2），归一化后应完全一致 → 均值等于其中任一条
    tencent: (code) => {
      if (code === 'usNVDA.OQ') return rampedBars(40, 10, 1)
      if (code === 'usAMD.OQ') return rampedBars(40, 20, 2)
      return null
    },
  })
  const result = await fetchKlineSeries('us-BK1134', 'day')
  assert.ok(result)
  assert.equal(result.klines.length, 40)
  assert.equal(result.sourceLabel, '代理股日线均值合成')
  assert.ok(result.note?.includes('英伟达(NVDA)'), result.note)
  assert.ok(result.note?.includes('基准=100'), result.note)
  assert.equal(result.klines[0]?.close, 100)
  assert.equal(result.klines[39]?.close, 490, '第 40 根 = 100 × (10 + 39) / 10')
  assert.ok(
    result.klines.every((bar) => bar.volume === 0),
    '合成量无口径（恒 0，图表自动隐藏量面板）',
  )
  // 代理腿走既有腾讯 → 新浪兜底链，按候选后缀探测
  assert.ok(log.tencent.includes('usNVDA.OQ:day'))
  assert.ok(log.tencent.includes('usAMD.OQ:day'))
  assert.deepEqual(log.eastmoney, [])
})

test('美股板块周 K：由代理股日线均值聚合（合成标的只有日线）', async (t) => {
  t.after(restore)
  const log = newLog()
  installStub(log, {
    tencent: (code) => (code === 'usSOXX.OQ' ? rampedBars(40, 10, 1) : null),
  })
  const result = await fetchKlineSeries('us-BK0917', 'week')
  assert.ok(result)
  assert.equal(result.aggregated, true)
  assert.ok(result.sourceLabel.includes('周K聚合'), result.sourceLabel)
  assert.deepEqual(log.tencent, ['usSOXX.OQ:day'], '单代理板块只请求该代理的日线')
})

test('美股板块日 K：单只代理失败自动跳过（部分可用即合成），全部失败返回空态', async (t) => {
  t.after(restore)
  const log = newLog()
  // AI算力板块有 5 只代理，只让英伟达命中：其余自动跳过，仍能合成
  installStub(log, {
    tencent: (code) => (code === 'usNVDA.OQ' ? rampedBars(30, 10, 1) : null),
  })
  const partial = await fetchKlineSeries('us-BK1134', 'day')
  assert.ok(partial, '部分代理可用时应合成成功')
  assert.equal(partial.klines.length, 30)
  assert.ok(partial.note?.includes('英伟达(NVDA)'), partial.note)
  assert.ok(!partial.note?.includes('超威半导体'), '失败的代理不进入口径文案')

  log.tencent.length = 0
  installStub(log, { tencent: () => null })
  clearKlineCache()
  assert.equal(await fetchKlineSeries('us-BK1134', 'day'), null, '全部代理失败 → 空态')
})

test('交叉汇率日 K：两腿逐日相除（分子 ÷ 分母），缺腿日期剔除', async (t) => {
  t.after(restore)
  const log = newLog()
  installStub(log, {
    sina: (kind, symbol) => {
      if (kind !== 'forex') return null
      if (symbol === 'USDKRW') return rampedBars(30, 1200, 6)
      if (symbol === 'USDCNH') return rampedBars(30, 6, 0)
      return null
    },
  })
  const result = await fetchKlineSeries('CNYKRW', 'day')
  assert.ok(result)
  assert.equal(result.sourceLabel, '两腿日线合成')
  assert.ok(result.note?.includes('美元/韩元'), result.note)
  assert.equal(result.klines.length, 30)
  assert.equal(result.klines[0]?.close, 200, '1200 ÷ 6')
  assert.equal(result.klines[29]?.close, 229, '(1200 + 29 × 6) ÷ 6')
  assert.deepEqual(log.sina, ['forex:USDKRW:day', 'forex:USDCNH:day'])

  // 换周期：合成结果与两腿都命中缓存（新浪外汇日线为全量历史，不应重复拉取）
  log.sina.length = 0
  const weekly = await fetchKlineSeries('CNYKRW', 'week')
  assert.ok(weekly)
  assert.equal(weekly.aggregated, true)
  assert.deepEqual(log.sina, [], '腿数据命中缓存，换周期不重复请求')
})

test('交叉汇率日 K：任一条腿失败即返回空态（不展示半条腿的错值）', async (t) => {
  t.after(restore)
  const log = newLog()
  installStub(log, {
    sina: (kind, symbol) => (symbol === 'USDKRW' ? rampedBars(30, 1200, 6) : null),
  })
  assert.equal(await fetchKlineSeries('CNYKRW', 'day'), null)
  assert.deepEqual(log.sina, ['forex:USDKRW:day', 'forex:USDCNH:day'])
})
