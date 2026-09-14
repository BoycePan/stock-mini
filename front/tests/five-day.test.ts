import assert from 'node:assert/strict'
import test from 'node:test'

import {
  countPointDays,
  parseSinaFiveMinuteBars,
  parseTencentFiveDay,
} from '../utils/five-day-parser.ts'
import {
  fetchFiveDayData,
  fetchMinuteData,
  filterToSession,
  fiveDaySinaCode,
  fiveDayTencentCode,
  hasFiveDaySource,
} from '../utils/minute.ts'
import { minuteApi } from '../api/minute.ts'
import { fiveDayApi } from '../api/five-day.ts'
import type { MinutePoint } from '../types/stock.ts'

// ---------------------------------------------------------------------------
// 腾讯五日（day/query）解析
// ---------------------------------------------------------------------------

/** 造腾讯 day/query 出参：日序为由新到旧，行内第 3/4 列是累计量/累计额 */
function tencentFiveDayBody(days: Array<{ date: string; rows: string[] }>) {
  return {
    code: 0,
    msg: '',
    data: {
      sh600519: {
        data: days.map((d) => ({ date: d.date, data: d.rows })),
        qt: { sh600519: ['1', '贵州茅台', '600519', '1277.96', '1275.16'] },
      },
      market: ['2026-09-14 16:52:28|HK_close_已收盘'],
    },
  }
}

test('腾讯五日：日序反转为时间升序，累计量/额差分出单分钟量，均价按 额/(量×100) 推算', () => {
  const body = tencentFiveDayBody([
    {
      date: '20260914',
      rows: ['0930 10.00 100 100000.00', '0931 10.10 300 302000.00', '1500 10.20 500 510000.00'],
    },
    {
      date: '20260911',
      rows: ['0930 9.90 50 49500.00', '0931 9.95 150 149000.00'],
    },
  ])
  const result = parseTencentFiveDay(body)
  assert.ok(result)
  assert.equal(result.points.length, 5)
  // 升序：先 0911 再 0914
  assert.equal(result.points[0]?.timeFull, '2026-09-11 09:30')
  assert.equal(result.points[4]?.timeFull, '2026-09-14 15:00')
  // 单分钟量 = 累计差分
  assert.deepEqual(
    result.points.slice(2).map((p) => p.volume),
    [100, 200, 200],
  )
  // 均价：302000 / (300×100) ≈ 10.07
  const second = result.points[3]
  assert.ok(second && second.avg !== null && Math.abs(second.avg - 10.0666) < 0.01)
  // 0% 基准取区间首点
  assert.equal(result.preClose, 9.9)
  // 时间短格式与完整时间戳都要有
  assert.equal(result.points[0]?.time, '09:30')
})

test('腾讯五日：均价推导偏离现价 0.5~2 倍时置空（指数没有每股价格口径）', () => {
  const body = tencentFiveDayBody([
    {
      date: '20260914',
      rows: ['0930 3867.02 4768998 7187284959.60', '0931 3877.29 19797346 31115332737.40'],
    },
  ])
  const result = parseTencentFiveDay(body)
  assert.ok(result)
  for (const point of result.points) {
    assert.equal(point.avg, null, '指数量额口径无法推算均价 → 不出均价线')
  }
})

test('腾讯五日：空数据 / 结构异常返回 null', () => {
  assert.equal(parseTencentFiveDay(undefined), null)
  assert.equal(parseTencentFiveDay({ data: { sh600519: { data: [] } } }), null)
  assert.equal(parseTencentFiveDay({ data: { market: ['x'] } }), null)
})

test('countPointDays：按 timeFull 统计自然日数（五日有效性校验用）', () => {
  const points: MinutePoint[] = [
    { time: '09:30', timeFull: '2026-09-11 09:30', price: 10, avg: null, volume: 1 },
    { time: '09:31', timeFull: '2026-09-11 09:31', price: 10, avg: null, volume: 1 },
    { time: '09:30', timeFull: '2026-09-14 09:30', price: 10, avg: null, volume: 1 },
  ]
  assert.equal(countPointDays(points), 2)
  assert.equal(countPointDays([]), 0)
  // 无日期信息（当日分时短时间格式）→ 0 天，调用方据此判定「不是五日数据」
  const noDate: MinutePoint[] = [{ time: '09:30', price: 10, avg: null, volume: 1 }]
  assert.equal(countPointDays(noDate), 0)
})

// ---------------------------------------------------------------------------
// 新浪 5 分钟 K 线解析
// ---------------------------------------------------------------------------

test('新浪五日：5 分钟柱取收盘价，时间取结束时刻并带完整时间戳', () => {
  const points = parseSinaFiveMinuteBars([
    {
      day: '2026-09-08 09:35:00',
      open: '1.0',
      high: '1.2',
      low: '0.9',
      close: '1.1',
      volume: '1000',
    },
    {
      day: '2026-09-08 09:40:00',
      open: '1.1',
      high: '1.3',
      low: '1.0',
      close: '1.25',
      volume: '800',
    },
  ])
  assert.equal(points.length, 2)
  assert.equal(points[0]?.time, '09:35')
  assert.equal(points[0]?.timeFull, '2026-09-08 09:35')
  assert.equal(points[0]?.price, 1.1)
  assert.equal(points[0]?.avg, null)
  assert.equal(points[1]?.volume, 800)
  assert.deepEqual(parseSinaFiveMinuteBars(null), [])
  assert.deepEqual(parseSinaFiveMinuteBars([{ day: 'bad' }]), [])
})

// ---------------------------------------------------------------------------
// 代码推导与时段过滤
// ---------------------------------------------------------------------------

test('五日代码推导：A股 / 港股 / A股指数可用，美股 / 期货 / 板块返回空串', () => {
  assert.equal(fiveDayTencentCode('sh600519'), 'sh600519')
  assert.equal(fiveDayTencentCode('sz399006'), 'sz399006')
  assert.equal(fiveDayTencentCode('hk00700'), 'hk00700')
  assert.equal(fiveDayTencentCode('1.600519'), 'sh600519')
  assert.equal(fiveDayTencentCode('0.002428'), 'sz002428')
  assert.equal(fiveDayTencentCode('105.NVDA'), '')
  assert.equal(fiveDayTencentCode('BK1134'), '')
  assert.equal(fiveDayTencentCode('GOLD'), '', '沪金主连无腾讯五日')

  assert.equal(fiveDaySinaCode('sh000001'), 'sh000001')
  assert.equal(fiveDaySinaCode('1.600519'), 'sh600519')
  assert.equal(fiveDaySinaCode('hk00700'), '', '新浪 5 分钟 K 线仅 A股')
})

test('hasFiveDaySource：有东财 secid 即视为可能可用（push2 多日），纯美股 secid 也走东财', () => {
  assert.equal(hasFiveDaySource('sh600519'), true)
  assert.equal(hasFiveDaySource('105.NVDA'), true)
  assert.equal(hasFiveDaySource('BK1134'), true)
  assert.equal(hasFiveDaySource('us-BK1134'), true)
  assert.equal(hasFiveDaySource('NOT_A_CODE'), false)
})

test('filterToSession：剔除非交易时段的行（腾讯五日含 15:01-15:30 收盘后固定价）', () => {
  const rows: MinutePoint[] = [
    { time: '09:30', timeFull: '2026-09-14 09:30', price: 10, avg: null, volume: 1 },
    { time: '11:30', timeFull: '2026-09-14 11:30', price: 10, avg: null, volume: 1 },
    { time: '12:00', timeFull: '2026-09-14 12:00', price: 10, avg: null, volume: 1 },
    { time: '15:00', timeFull: '2026-09-14 15:00', price: 10, avg: null, volume: 1 },
    { time: '15:20', timeFull: '2026-09-14 15:20', price: 10, avg: null, volume: 1 },
  ]
  const kept = filterToSession(rows, 'ashare')
  assert.deepEqual(
    kept.map((p) => p.time),
    ['09:30', '11:30', '15:00'],
  )
  // 连续交易标的（外汇 / 期货）不过滤
  assert.equal(filterToSession(rows, 'continuous').length, 5)
})

// ---------------------------------------------------------------------------
// 五日兜底链（桩住两个 api）
// ---------------------------------------------------------------------------

const originalEm = minuteApi.eastmoney
const originalTcFive = fiveDayApi.tencent
const originalSinaFive = fiveDayApi.sina

/** 造「跨 3 个自然日」的东财多日分时结果 */
function multiDayResult() {
  return {
    preClose: 10,
    points: [
      { time: '2026-09-10 09:30', timeFull: '2026-09-10 09:30', price: 10, avg: null, volume: 1 },
      { time: '2026-09-11 09:30', timeFull: '2026-09-11 09:30', price: 10.2, avg: null, volume: 1 },
      { time: '2026-09-14 09:30', timeFull: '2026-09-14 09:30', price: 10.4, avg: null, volume: 1 },
    ],
  }
}

function installFiveDayStub(
  log: string[],
  opts: { em?: 'multi' | 'single' | 'fail'; tencent?: boolean; sina?: boolean },
): void {
  minuteApi.eastmoney = async (_secid, options) => {
    log.push(`em:${options?.host ?? 'delay'}:${options?.ndays ?? 1}`)
    if (opts.em === 'multi') return multiDayResult()
    if (opts.em === 'single') {
      // 延迟节点语义：忽略 ndays，只返回当日
      return {
        preClose: 10,
        points: [
          {
            time: '2026-09-14 09:30',
            timeFull: '2026-09-14 09:30',
            price: 10,
            avg: null,
            volume: 1,
          },
          {
            time: '2026-09-14 09:31',
            timeFull: '2026-09-14 09:31',
            price: 10.1,
            avg: null,
            volume: 1,
          },
        ],
      }
    }
    return null
  }
  fiveDayApi.tencent = async (code) => {
    log.push(`tx:${code}`)
    if (!opts.tencent) return null
    return {
      preClose: 10,
      points: [
        { time: '09:30', timeFull: '2026-09-10 09:30', price: 10, avg: null, volume: 1 },
        { time: '15:20', timeFull: '2026-09-10 15:20', price: 10, avg: null, volume: 1 },
        { time: '09:30', timeFull: '2026-09-14 09:30', price: 10.5, avg: null, volume: 1 },
      ],
    }
  }
  fiveDayApi.sina = async (code) => {
    log.push(`sina:${code}`)
    if (!opts.sina) return null
    return {
      preClose: 10,
      points: [
        { time: '09:35', timeFull: '2026-09-10 09:35', price: 10, avg: null, volume: 1 },
        { time: '09:40', timeFull: '2026-09-14 09:40', price: 10.5, avg: null, volume: 1 },
      ],
    }
  }
}

function restoreFiveDay(): void {
  minuteApi.eastmoney = originalEm
  fiveDayApi.tencent = originalTcFive
  fiveDayApi.sina = originalSinaFive
}

test('五日链路：东财 push2 返回真正的多日数据时首选（一次请求即命中）', async (t) => {
  t.after(restoreFiveDay)
  const log: string[] = []
  installFiveDayStub(log, { em: 'multi' })
  const result = await fetchFiveDayData('sh600519')
  assert.ok(result)
  assert.equal(result.sourceLabel, '东方财富五日分时')
  assert.deepEqual(log, ['em:push2:5'], '命中后不再请求腾讯 / 新浪')
})

test('五日链路：东财只回当日（延迟节点语义）时自动回退腾讯，并过滤非交易时段行', async (t) => {
  t.after(restoreFiveDay)
  const log: string[] = []
  installFiveDayStub(log, { em: 'single', tencent: true })
  const result = await fetchFiveDayData('sh600519')
  assert.ok(result)
  assert.equal(result.sourceLabel, '腾讯五日分时')
  assert.deepEqual(log, ['em:push2:5', 'tx:sh600519'])
  assert.deepEqual(
    result.points.map((p) => p.timeFull),
    ['2026-09-10 09:30', '2026-09-14 09:30'],
    '15:20 收盘后固定价行被剔除',
  )
  // 0% 基准取区间首点
  assert.equal(result.preClose, 10)
})

test('五日链路：东财与腾讯都不可用时回退新浪 5 分钟', async (t) => {
  t.after(restoreFiveDay)
  const log: string[] = []
  installFiveDayStub(log, { em: 'fail', sina: true })
  const result = await fetchFiveDayData('1.600519')
  assert.ok(result)
  assert.equal(result.sourceLabel, '新浪五日（5分钟）')
  assert.deepEqual(log, ['em:push2:5', 'tx:sh600519', 'sina:sh600519'])
})

test('五日链路：三条源全部失败返回 null（页面展示暂无数据），美股不回退腾讯 / 新浪', async (t) => {
  t.after(restoreFiveDay)
  const log: string[] = []
  installFiveDayStub(log, { em: 'fail', tencent: true, sina: true })
  assert.equal(await fetchFiveDayData('105.NVDA'), null)
  assert.deepEqual(log, ['em:push2:5'], '美股无腾讯五日 / 新浪 A股 5 分钟源，不发起无效请求')

  log.length = 0
  assert.equal(await fetchFiveDayData('not-a-code'), null)
  assert.deepEqual(log, [], '无任何源的代码不发请求')
})

test('当日分时链路不受影响：仍走 delay 节点 + ndays=1，并保留腾讯兜底', async (t) => {
  t.after(restoreFiveDay)
  const log: string[] = []
  installFiveDayStub(log, { em: 'single', tencent: true })
  const result = await fetchMinuteData('sh600519')
  assert.ok(result)
  assert.deepEqual(log, ['em:delay:1'])
  assert.equal(result.sourceLabel, '东方财富分时')
})
