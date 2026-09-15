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
  fiveDayTencentUsCode,
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

test('腾讯五日：均价先按真实成交额（额 ÷ 量）推算，港股「股」与 A股「手」两种量纲都能命中', () => {
  // 港股实测行：量 = 股，额 ÷ 量 = 现价（本样例 428.000）
  const hk = parseTencentFiveDay({
    data: {
      hk00700: {
        data: [
          { date: '20260914', data: ['0930 428.000 771528 330214056.800'] },
          { date: '20260911', data: ['0930 430.000 100000 43000000.000'] },
        ],
      },
    },
  })
  assert.ok(hk)
  // 日序由新到旧 → 反转后 points[0] 是最早的一天（2026-09-11）
  assert.ok(Math.abs((hk.points[0]?.avg ?? 0) - 430) < 0.01, '量=股 → 额/量 即均价')
  assert.ok(Math.abs((hk.points[1]?.avg ?? 0) - 428) < 0.01)
})

test('腾讯五日：指数量额口径不成立时，均价退化为成交量加权近似（不是直接不出均价线）', () => {
  const body = tencentFiveDayBody([
    {
      date: '20260914',
      rows: ['0930 3867.02 4768998 7187284959.60', '0931 3877.29 19797346 31115332737.40'],
    },
  ])
  const result = parseTencentFiveDay(body)
  assert.ok(result)
  // 第一分钟：当日只有这一分钟的成交 → 近似均价 = 该分钟价
  assert.ok(Math.abs((result.points[0]?.avg ?? 0) - 3867.02) < 0.01)
  // 第二分钟：按分钟量加权（介于 3867.02 与 3877.29 之间，且偏向放量的一分钟）
  const second = result.points[1]?.avg ?? 0
  assert.ok(second > 3867.02 && second < 3877.29, `加权近似应落在两分钟价格之间：${second}`)
})

test('腾讯五日：完全无量（无量标的）时均价为 null，只画价格线', () => {
  const result = parseTencentFiveDay(
    tencentFiveDayBody([
      { date: '20260914', rows: ['0930 10.00 0', '0931 10.10 0', '1500 10.20 0'] },
    ]),
  )
  assert.ok(result)
  for (const point of result.points) {
    assert.equal(point.avg, null, '无量 → 无法加权，均价线不出')
  }
})

test('腾讯五日：空数据 / 结构异常返回 null', () => {
  assert.equal(parseTencentFiveDay(undefined), null)
  assert.equal(parseTencentFiveDay({ data: { sh600519: { data: [] } } }), null)
  assert.equal(parseTencentFiveDay({ data: { market: ['x'] } }), null)
})

test('腾讯美股五日（dayus）：行内只有 时间 现价 累计量（无累计额）→ 量差分 + 均价按量加权近似', () => {
  // 实测美股行样例（usDJI）：09:30 起每分钟一行，第三列是累计成交量，没有累计成交额
  const body = {
    code: 0,
    msg: '',
    data: {
      usDJI: {
        data: [
          { date: '20260915', data: ['0930 52251.28 0', '0931 52200.10 1200'] },
          { date: '20260914', data: ['0930 52707.90 500', '0931 52750.88 900'] },
        ],
      },
    },
  }
  const result = parseTencentFiveDay(body)
  assert.ok(result)
  assert.equal(result.points.length, 4)
  // 日序由新到旧 → 反转成升序
  assert.equal(result.points[0]?.timeFull, '2026-09-14 09:30')
  assert.equal(result.points[3]?.timeFull, '2026-09-15 09:31')
  // 单分钟量 = 相邻累计值差分（跨日归零重算）
  assert.deepEqual(
    result.points.map((p) => p.volume),
    [500, 400, 0, 1200],
  )
  // 均价：无成交额列 → 按「分钟价 × 分钟量」加权（首分钟量=0 → 该点无均价）
  assert.equal(result.points[0]?.avg, 52707.9)
  assert.ok(Math.abs((result.points[1]?.avg ?? 0) - 52727.01) < 0.05, '两分钟加权')
  assert.equal(result.points[2]?.avg, null, '该分钟量为 0 → 无均价点')
  assert.equal(result.points[3]?.avg, 52200.1)
  assert.equal(result.preClose, 52707.9, '0% 基准取区间首点')
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

test('美股五日代码推导：指数 / ETF / 东财美股 secid 可用，代理板块与无数据指数返回空串', () => {
  assert.equal(fiveDayTencentUsCode('usDJI'), 'usDJI')
  assert.equal(fiveDayTencentUsCode('usINX'), 'usINX')
  assert.equal(fiveDayTencentUsCode('usIXIC'), 'usIXIC')
  assert.equal(fiveDayTencentUsCode('TLT'), 'usTLT')
  assert.equal(fiveDayTencentUsCode('105.NVDA'), 'usNVDA')
  assert.equal(fiveDayTencentUsCode('105.tlt'), 'usTLT', 'secid 不区分大小写')
  assert.equal(fiveDayTencentUsCode('106.BRK_B'), 'usBRK.B', '东财下划线类别股 → 腾讯点号')
  assert.equal(fiveDayTencentUsCode('SOX'), '', '腾讯无费半数据（同 K 线覆盖结论）')
  assert.equal(fiveDayTencentUsCode('us-BK1134'), '', '代理合成板块无单一腾讯标的')
  assert.equal(fiveDayTencentUsCode('sh600519'), '')
  assert.equal(fiveDayTencentUsCode('GOLD'), '')
})

test('hasFiveDaySource：有分时源即视为五日 TAB 可用（美股走 dayus / 板块走东财兜底）', () => {
  assert.equal(hasFiveDaySource('sh600519'), true)
  assert.equal(hasFiveDaySource('usDJI'), true)
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
// 五日兜底链（桩住三个 api）
// ---------------------------------------------------------------------------

const originalEm = minuteApi.eastmoney
const originalUsFive = fiveDayApi.tencentUs
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
  opts: { em?: 'multi' | 'single' | 'fail'; us?: boolean; tencent?: boolean; sina?: boolean },
): void {
  minuteApi.eastmoney = async (_secid, options) => {
    log.push(`em:${options?.host ?? 'delay'}:${options?.ndays ?? 1}`)
    if (opts.em === 'multi') return multiDayResult()
    if (opts.em === 'single') {
      // push2 / push2delay 的实际语义：忽略 ndays，只返回当日
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
  fiveDayApi.tencentUs = async (code) => {
    log.push(`txus:${code}`)
    if (!opts.us) return null
    // 美股行：交易所本地时钟 09:30-16:00 ET，跨 2 个交易日
    return {
      preClose: 52000,
      points: [
        { time: '09:30', timeFull: '2026-09-14 09:30', price: 52000, avg: null, volume: 1 },
        { time: '16:00', timeFull: '2026-09-14 16:00', price: 52400, avg: null, volume: 1 },
        { time: '09:30', timeFull: '2026-09-15 09:30', price: 52300, avg: null, volume: 1 },
      ],
    }
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
  fiveDayApi.tencentUs = originalUsFive
  fiveDayApi.tencent = originalTcFive
  fiveDayApi.sina = originalSinaFive
}

test('五日链路：美股（道琼斯等）走腾讯 dayus，命中即返回', async (t) => {
  t.after(restoreFiveDay)
  const log: string[] = []
  installFiveDayStub(log, { em: 'single', us: true })
  const result = await fetchFiveDayData('usDJI')
  assert.ok(result)
  assert.equal(result.sourceLabel, '腾讯美股五日')
  assert.deepEqual(log, ['txus:usDJI'], '美股命中后不再打东财 push2 与 A股源')
  assert.deepEqual(
    result.points.map((p) => p.timeFull),
    ['2026-09-14 09:30', '2026-09-14 16:00', '2026-09-15 09:30'],
    '美股时段（09:30-16:00 ET）内的点全部保留',
  )
  assert.equal(result.preClose, 52000)

  // 美股个股（东财 secid）同样走 dayus
  log.length = 0
  const stock = await fetchFiveDayData('105.NVDA')
  assert.ok(stock)
  assert.equal(stock.sourceLabel, '腾讯美股五日')
  assert.deepEqual(log, ['txus:usNVDA'])
})

test('五日链路：A股 / 港股直接走腾讯 day/query（不再先请求东财 push2 多日）', async (t) => {
  t.after(restoreFiveDay)
  const log: string[] = []
  installFiveDayStub(log, { em: 'single', tencent: true })
  const result = await fetchFiveDayData('sh600519')
  assert.ok(result)
  assert.equal(result.sourceLabel, '腾讯五日分时')
  assert.deepEqual(log, ['tx:sh600519'])
  assert.deepEqual(
    result.points.map((p) => p.timeFull),
    ['2026-09-10 09:30', '2026-09-14 09:30'],
    '15:20 收盘后固定价行被剔除',
  )
  // 0% 基准取区间首点
  assert.equal(result.preClose, 10)
})

test('五日链路：腾讯五日不可用时回退新浪 5 分钟', async (t) => {
  t.after(restoreFiveDay)
  const log: string[] = []
  installFiveDayStub(log, { em: 'fail', sina: true })
  const result = await fetchFiveDayData('1.600519')
  assert.ok(result)
  assert.equal(result.sourceLabel, '新浪五日（5分钟）')
  assert.deepEqual(log, ['tx:sh600519', 'sina:sh600519'])
})

test('五日链路：东财 push2 真返回多日数据时作为兜底命中（板块 / 期货等无腾讯源的标的）', async (t) => {
  t.after(restoreFiveDay)
  const log: string[] = []
  installFiveDayStub(log, { em: 'multi' })
  // BK1134 为东财板块指数：无腾讯 day / dayus / 新浪五日源，只能落到东财兜底
  const result = await fetchFiveDayData('BK1134')
  assert.ok(result)
  assert.equal(result.sourceLabel, '东方财富五日分时')
  assert.deepEqual(log, ['em:push2:5'])
})

test('五日链路：所有源都失败返回 null（页面展示暂无数据），无源代码不发请求', async (t) => {
  t.after(restoreFiveDay)
  const log: string[] = []
  // 东财 push2 只回当日 → countPointDays 校验拦下；腾讯 dayus / day 与新浪均失败
  installFiveDayStub(log, { em: 'single' })
  assert.equal(await fetchFiveDayData('105.NVDA'), null)
  assert.deepEqual(log, ['txus:usNVDA', 'em:push2:5'], '美股只打 dayus，不打 A股 / 新浪源')

  log.length = 0
  // SOX（费半）：腾讯无对应数据 → 不发 dayus 请求，只剩东财兜底
  assert.equal(await fetchFiveDayData('SOX'), null)
  assert.deepEqual(log, ['em:push2:5'])

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
