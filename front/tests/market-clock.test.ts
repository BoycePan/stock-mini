import assert from 'node:assert/strict'
import test from 'node:test'

import { getRegionStatus, isMarketHoliday, isMarketTradingDay } from '../utils/market-clock.ts'

/** 以 UTC 时刻构造 Date（各市场本地时间由被测函数换算） */
const at = (iso: string): Date => new Date(iso)

// ---------------------------------------------------------------------------
// A股（北京时间 UTC+8）
// ---------------------------------------------------------------------------

test('A股：工作日盘中 / 午休 / 集合竞价 / 休市', () => {
  // 2026-08-20（周四）北京时间
  assert.deepEqual(getRegionStatus('cn', at('2026-08-20T02:00:00Z')), {
    kind: 'open',
    label: '盘中',
    tone: 'active',
  })
  assert.deepEqual(getRegionStatus('cn', at('2026-08-20T04:00:00Z')), {
    kind: 'break',
    label: '午休',
    tone: 'quiet',
  })
  assert.deepEqual(getRegionStatus('cn', at('2026-08-20T01:20:00Z')), {
    kind: 'auction',
    label: '集合竞价',
    tone: 'quiet',
  })
  assert.deepEqual(getRegionStatus('cn', at('2026-08-20T06:30:00Z')), {
    kind: 'open',
    label: '盘中',
    tone: 'active',
  })
  assert.equal(getRegionStatus('cn', at('2026-08-20T07:30:00Z')).label, '休市') // 15:30 后
  assert.equal(getRegionStatus('cn', at('2026-08-20T00:00:00Z')).label, '休市') // 08:00 前
})

test('A股：法定节假日休市（2026 国庆 / 春节 / 劳动节 / 端午 / 中秋）', () => {
  assert.equal(getRegionStatus('cn', at('2026-10-01T02:00:00Z')).label, '休市') // 国庆
  assert.equal(getRegionStatus('cn', at('2026-10-07T02:00:00Z')).label, '休市')
  assert.equal(getRegionStatus('cn', at('2026-10-08T02:00:00Z')).label, '盘中') // 10/8 起开市
  assert.equal(getRegionStatus('cn', at('2026-02-23T02:00:00Z')).label, '休市') // 春节最后一天
  assert.equal(getRegionStatus('cn', at('2026-02-24T02:00:00Z')).label, '盘中') // 2/24 起开市
  assert.equal(getRegionStatus('cn', at('2026-05-01T02:00:00Z')).label, '休市') // 劳动节
  assert.equal(getRegionStatus('cn', at('2026-05-06T02:00:00Z')).label, '盘中')
  assert.equal(getRegionStatus('cn', at('2026-06-19T02:00:00Z')).label, '休市') // 端午
  assert.equal(getRegionStatus('cn', at('2026-09-25T02:00:00Z')).label, '休市') // 中秋
  assert.equal(getRegionStatus('cn', at('2025-02-03T02:00:00Z')).label, '休市') // 2025 春节
  assert.equal(getRegionStatus('cn', at('2025-02-05T02:00:00Z')).label, '盘中')
})

test('A股：周末休市；未维护年份回退到周末判定', () => {
  assert.equal(getRegionStatus('cn', at('2026-08-22T02:00:00Z')).label, '休市') // 周六
  assert.equal(getRegionStatus('cn', at('2026-08-23T02:00:00Z')).label, '休市') // 周日
  assert.equal(
    isMarketHoliday('cn', at('2027-01-01T02:00:00Z')),
    false,
    '2027 日历未发布，不做节假日判定',
  )
  assert.equal(isMarketTradingDay('cn', at('2026-08-20T02:00:00Z')), true)
  assert.equal(isMarketTradingDay('cn', at('2026-10-01T02:00:00Z')), false)
})

// ---------------------------------------------------------------------------
// 美股（美东时间，含夏令时）
// ---------------------------------------------------------------------------

test('美股：盘前 / 盘中 / 盘后 / 休市（EDT）', () => {
  // 2026-08-20（周四）EDT
  assert.deepEqual(getRegionStatus('us', at('2026-08-20T14:30:00Z')), {
    kind: 'open',
    label: '盘中',
    tone: 'active',
  })
  assert.deepEqual(getRegionStatus('us', at('2026-08-20T12:00:00Z')), {
    kind: 'pre',
    label: '盘前',
    tone: 'quiet',
  })
  assert.deepEqual(getRegionStatus('us', at('2026-08-20T21:00:00Z')), {
    kind: 'post',
    label: '盘后',
    tone: 'quiet',
  })
  assert.equal(getRegionStatus('us', at('2026-08-21T01:30:00Z')).label, '休市') // ET 21:30
})

test('美股：夏令时边界（3/8 后 EDT、11/1 后 EST）', () => {
  assert.equal(getRegionStatus('us', at('2026-03-09T14:30:00Z')).label, '盘中') // EDT 10:30
  assert.equal(getRegionStatus('us', at('2026-11-02T15:30:00Z')).label, '盘中') // EST 10:30
})

test('美股：法定节假日休市（含 7/3 调休），半日市 13:00 收盘', () => {
  assert.equal(getRegionStatus('us', at('2026-12-25T17:00:00Z')).label, '休市') // 圣诞
  assert.equal(getRegionStatus('us', at('2026-01-19T15:00:00Z')).label, '休市') // MLK
  assert.equal(getRegionStatus('us', at('2026-07-03T14:00:00Z')).label, '休市') // 独立日调休
  assert.equal(getRegionStatus('us', at('2026-12-24T17:00:00Z')).label, '盘中') // 平安夜半日市 12:00 仍交易
  assert.equal(getRegionStatus('us', at('2026-12-24T18:00:00Z')).label, '休市') // 平安夜 13:00 收盘
  assert.equal(getRegionStatus('us', at('2026-11-27T18:00:00Z')).label, '休市') // 感恩节后一天半日市 13:00 后
})

// ---------------------------------------------------------------------------
// 日股（东京时间 UTC+9：09:00-11:30 / 12:30-15:30，2024-11-05 起收盘延至 15:30，午休保留）
// ---------------------------------------------------------------------------

test('日股：盘中 / 午休 / 休市', () => {
  assert.deepEqual(getRegionStatus('jp', at('2026-08-20T01:00:00Z')), {
    kind: 'open',
    label: '盘中',
    tone: 'active',
  })
  assert.deepEqual(getRegionStatus('jp', at('2026-08-20T03:00:00Z')), {
    kind: 'break',
    label: '午休',
    tone: 'quiet',
  })
  assert.deepEqual(getRegionStatus('jp', at('2026-08-20T05:00:00Z')), {
    kind: 'open',
    label: '盘中',
    tone: 'active',
  })
  assert.equal(getRegionStatus('jp', at('2026-08-20T07:00:00Z')).label, '休市') // JST 16:00
  assert.equal(getRegionStatus('jp', at('2026-08-19T23:30:00Z')).label, '休市') // JST 08:30
  assert.equal(getRegionStatus('jp', at('2026-08-20T06:29:00Z')).label, '盘中') // JST 15:29
  assert.equal(getRegionStatus('jp', at('2026-08-20T06:30:00Z')).label, '休市') // JST 15:30 收盘
})

test('日股：节假日休市（元旦 / 年初 / 宪法纪念日补休 / 勤劳感谢日）', () => {
  assert.equal(getRegionStatus('jp', at('2026-05-05T01:00:00Z')).label, '休市') // こどもの日
  assert.equal(getRegionStatus('jp', at('2026-05-06T01:00:00Z')).label, '休市') // 5/3 周日补休
  assert.equal(getRegionStatus('jp', at('2026-01-02T01:00:00Z')).label, '休市') // 年末年始
  assert.equal(getRegionStatus('jp', at('2026-11-23T01:00:00Z')).label, '休市') // 勤労感謝の日
  assert.equal(getRegionStatus('jp', at('2026-11-24T01:00:00Z')).label, '盘中') // 次日正常开市
})

// ---------------------------------------------------------------------------
// 韩股（首尔时间 UTC+9：09:00-15:30 连续交易，无午休）
// ---------------------------------------------------------------------------

test('韩股：盘中无午休 / 休市', () => {
  assert.deepEqual(getRegionStatus('kr', at('2026-08-20T01:00:00Z')), {
    kind: 'open',
    label: '盘中',
    tone: 'active',
  })
  assert.deepEqual(getRegionStatus('kr', at('2026-08-20T03:00:00Z')), {
    kind: 'open',
    label: '盘中',
    tone: 'active',
  }) // 12:00 无午休
  assert.equal(getRegionStatus('kr', at('2026-08-20T06:29:00Z')).label, '盘中') // 15:29
  assert.equal(getRegionStatus('kr', at('2026-08-20T06:30:00Z')).label, '休市') // 15:30 收盘
  assert.equal(getRegionStatus('kr', at('2026-08-19T23:59:00Z')).label, '休市') // KST 08:59
})

test('韩股：节假日休市（2026 特别项：选举日 / 制宪节 / 佛诞补休 / 显忠日无补休）', () => {
  assert.equal(getRegionStatus('kr', at('2026-06-03T01:00:00Z')).label, '休市') // 地方选举日
  assert.equal(getRegionStatus('kr', at('2026-07-17T01:00:00Z')).label, '休市') // 制宪节（2026 起新列公休日）
  assert.equal(getRegionStatus('kr', at('2026-05-25T01:00:00Z')).label, '休市') // 佛诞日（5/24 周日补休）
  assert.equal(getRegionStatus('kr', at('2026-05-05T01:00:00Z')).label, '休市') // 儿童节
  assert.equal(getRegionStatus('kr', at('2026-08-17T01:00:00Z')).label, '休市') // 光复节（8/15 周六补休）
  assert.equal(getRegionStatus('kr', at('2026-06-08T01:00:00Z')).label, '盘中') // 显忠日（周六）无补休，周一开市
  assert.equal(getRegionStatus('kr', at('2026-09-28T01:00:00Z')).label, '盘中') // 秋夕（周六）无补休，周一开市
  assert.equal(getRegionStatus('kr', at('2026-12-31T01:00:00Z')).label, '休市') // 年末休市
})
