import assert from 'node:assert/strict'
import test from 'node:test'

import { klineApi } from '../api/kline.ts'
import { hasKlineSources, resolveKlineSources } from '../config/kline.ts'
import { MINUTE_SOURCES } from '../config/minute.ts'
import { clearKlineCache, fetchKlineSeries } from '../utils/kline-source.ts'
import type { KlinePoint } from '../types/stock.ts'

const originalTencent = klineApi.tencent
const originalSina = klineApi.sina

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

interface StubLog {
  tencent: string[]
  sina: string[]
}

/** 安装桩：按 (code, unit) 决定返回数据，记录调用序列 */
function installStub(
  log: StubLog,
  handler: {
    tencent?: (code: string, unit: string) => KlinePoint[] | null
    sina?: (kind: string, symbol: string, unit: string) => KlinePoint[] | null
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
}

function restore(): void {
  klineApi.tencent = originalTencent
  klineApi.sina = originalSina
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

test('resolveKlineSources：无国内 K 线源的标的返回 null（板块 / 平均股价 / 日韩指数 / 交叉汇率）', () => {
  for (const code of [
    'BK1134',
    'us-BK1134',
    'AVG',
    'KS11',
    'N225',
    'VNINDEX',
    'SENSEX',
    'SOX',
    'CNYKRW',
    'CNYJPY',
  ]) {
    assert.equal(resolveKlineSources(code), null, `${code} 应无 K 线源`)
    assert.equal(hasKlineSources(code), false)
  }
  // 原型链上的属性名不能被误判为「有源」
  assert.equal(resolveKlineSources('toString'), null)
  assert.equal(resolveKlineSources('__proto__'), null)
})

test('覆盖度：分时配置里的每个标的都要么有 K 线源、要么在「无源」白名单内（防止新增漏配）', () => {
  // 这些标的刻意不做 K 线（原因见 config/kline.ts 头部注释）
  const noKline = (code: string): boolean =>
    /^BK\d+$/.test(code) ||
    /^us-/.test(code) ||
    ['AVG', 'KS11', 'N225', 'VNINDEX', 'SENSEX', 'SOX', 'CNYKRW', 'CNYJPY'].includes(code)
  const missing: string[] = []
  for (const code of Object.keys(MINUTE_SOURCES)) {
    if (noKline(code)) continue
    if (!hasKlineSources(code)) missing.push(code)
  }
  assert.deepEqual(missing, [], `以下标的在分时配置中存在但未登记 K 线源：${missing.join(', ')}`)
})

// ---------------------------------------------------------------------------
// 兜底链与聚合
// ---------------------------------------------------------------------------

test('日 K：腾讯命中即返回，不再请求新浪', async (t) => {
  t.after(restore)
  const log: StubLog = { tencent: [], sina: [] }
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
  const log: StubLog = { tencent: [], sina: [] }
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
  const log: StubLog = { tencent: [], sina: [] }
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
  const log: StubLog = { tencent: [], sina: [] }
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
  const log: StubLog = { tencent: [], sina: [] }
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
  const log: StubLog = { tencent: [], sina: [] }
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
  const log: StubLog = { tencent: [], sina: [] }
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
  const log: StubLog = { tencent: [], sina: [] }
  installStub(log, { tencent: () => bars(30), sina: () => bars(30) })
  assert.equal(await fetchKlineSeries('BK1134', 'day'), null)
  assert.deepEqual(log.tencent, [])
  assert.deepEqual(log.sina, [])

  await fetchKlineSeries('sh600519', 'day')
  assert.equal(log.tencent.length, 1)
  clearKlineCache('sh600519')
  await fetchKlineSeries('sh600519', 'day')
  assert.equal(log.tencent.length, 2, '清缓存后重新请求')
})

test('全部源失败：返回 null（页面展示「该周期暂无数据」），不抛错', async (t) => {
  t.after(restore)
  const log: StubLog = { tencent: [], sina: [] }
  installStub(log, { tencent: () => null, sina: () => null })
  assert.equal(await fetchKlineSeries('sh600519', 'day'), null)
  assert.equal(await fetchKlineSeries('sh600519', 'year'), null)
})
