import assert from 'node:assert/strict'
import test from 'node:test'

import {
  getRegionStatus,
  isMarketHoliday,
  isMarketTradingDay,
  resolveIndustryPhase,
  resolveIndustryUseA,
  type MarketSession,
} from '../utils/market-clock.ts'

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

test('A股：法定节假日休市（2026-2027 国庆 / 春节 / 劳动节 / 端午 / 中秋）', () => {
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
  // 2027 年节假日
  assert.equal(getRegionStatus('cn', at('2027-01-01T02:00:00Z')).label, '休市') // 2027 元旦
  assert.equal(getRegionStatus('cn', at('2027-02-05T02:00:00Z')).label, '休市') // 2027 除夕
  assert.equal(getRegionStatus('cn', at('2027-02-12T02:00:00Z')).label, '休市') // 2027 初七
  assert.equal(getRegionStatus('cn', at('2027-02-15T02:00:00Z')).label, '盘中') // 2027 春节后首个交易日
  assert.equal(getRegionStatus('cn', at('2027-06-09T02:00:00Z')).label, '休市') // 2027 端午（周三）
  assert.equal(getRegionStatus('cn', at('2027-09-15T02:00:00Z')).label, '休市') // 2027 中秋（周三）
})

test('A股：周末休市；未维护年份回退到周末判定', () => {
  assert.equal(getRegionStatus('cn', at('2026-08-22T02:00:00Z')).label, '休市') // 周六
  assert.equal(getRegionStatus('cn', at('2026-08-23T02:00:00Z')).label, '休市') // 周日
  assert.equal(
    isMarketHoliday('cn', at('2028-01-01T02:00:00Z')),
    false,
    '2028 日历未发布，不做节假日判定',
  )
  assert.equal(isMarketTradingDay('cn', at('2026-08-20T02:00:00Z')), true)
  assert.equal(isMarketTradingDay('cn', at('2026-10-01T02:00:00Z')), false)
  assert.equal(isMarketTradingDay('cn', at('2027-01-01T02:00:00Z')), false)
  assert.equal(isMarketTradingDay('cn', at('2027-02-05T02:00:00Z')), false)
  assert.equal(isMarketTradingDay('cn', at('2027-02-15T02:00:00Z')), true)
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

test('美股：法定节假日休市（含 7/3、6/18、12/24 调休），半日市 13:00 收盘', () => {
  assert.equal(getRegionStatus('us', at('2026-12-25T17:00:00Z')).label, '休市') // 圣诞
  assert.equal(getRegionStatus('us', at('2026-01-19T15:00:00Z')).label, '休市') // MLK
  assert.equal(getRegionStatus('us', at('2026-07-03T14:00:00Z')).label, '休市') // 独立日调休
  assert.equal(getRegionStatus('us', at('2026-12-24T17:00:00Z')).label, '盘中') // 平安夜半日市 12:00 仍交易
  assert.equal(getRegionStatus('us', at('2026-12-24T18:00:00Z')).label, '休市') // 平安夜 13:00 收盘
  assert.equal(getRegionStatus('us', at('2026-11-27T18:00:00Z')).label, '休市') // 感恩节后一天半日市 13:00 后
  // 2027 美股节假日
  assert.equal(getRegionStatus('us', at('2027-06-18T15:00:00Z')).label, '休市') // Juneteenth 调休
  assert.equal(getRegionStatus('us', at('2027-07-05T15:00:00Z')).label, '休市') // 独立日调休
  assert.equal(getRegionStatus('us', at('2027-11-26T17:00:00Z')).label, '盘中') // 感恩节次日半日市 12:00 仍交易
  assert.equal(getRegionStatus('us', at('2027-11-26T18:00:00Z')).label, '休市') // 感恩节次日半日市 13:00 收盘
  assert.equal(getRegionStatus('us', at('2027-12-24T15:00:00Z')).label, '休市') // 圣诞节调休
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

test('日股：节假日休市（元旦 / 年初 / 宪法纪念日补休 / 勤劳感谢日 / 2027 年末）', () => {
  assert.equal(getRegionStatus('jp', at('2026-05-05T01:00:00Z')).label, '休市') // こどもの日
  assert.equal(getRegionStatus('jp', at('2026-05-06T01:00:00Z')).label, '休市') // 5/3 周日补休
  assert.equal(getRegionStatus('jp', at('2026-01-02T01:00:00Z')).label, '休市') // 年末年始
  assert.equal(getRegionStatus('jp', at('2026-11-23T01:00:00Z')).label, '休市') // 勤労感謝の日
  assert.equal(getRegionStatus('jp', at('2026-11-24T01:00:00Z')).label, '盘中') // 次日正常开市
  // 2027 日股节假日
  assert.equal(getRegionStatus('jp', at('2027-03-22T01:00:00Z')).label, '休市') // 春分の日（3/21 周日补休）
  assert.equal(getRegionStatus('jp', at('2027-12-31T01:00:00Z')).label, '休市') // 2027 年末休市
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

test('韩股：节假日休市（2026 特别项与 2027 自动补休）', () => {
  assert.equal(getRegionStatus('kr', at('2026-06-03T01:00:00Z')).label, '休市') // 地方选举日
  assert.equal(getRegionStatus('kr', at('2026-07-17T01:00:00Z')).label, '休市') // 制宪节（2026 起新列公休日）
  assert.equal(getRegionStatus('kr', at('2026-05-25T01:00:00Z')).label, '休市') // 佛诞日（5/24 周日补休）
  assert.equal(getRegionStatus('kr', at('2026-05-05T01:00:00Z')).label, '休市') // 儿童节
  assert.equal(getRegionStatus('kr', at('2026-08-17T01:00:00Z')).label, '休市') // 光复节（8/15 周六补休）
  assert.equal(getRegionStatus('kr', at('2026-06-08T01:00:00Z')).label, '盘中') // 显忠日（周六）无补休，周一开市
  assert.equal(getRegionStatus('kr', at('2026-09-28T01:00:00Z')).label, '盘中') // 秋夕（周六）无补休，周一开市
  assert.equal(getRegionStatus('kr', at('2026-12-31T01:00:00Z')).label, '休市') // 年末休市
  // 2027 韩股节假日
  assert.equal(getRegionStatus('kr', at('2027-07-19T01:00:00Z')).label, '休市') // 制宪节（7/17 周六补休）
  assert.equal(getRegionStatus('kr', at('2027-09-15T01:00:00Z')).label, '休市') // 秋夕（周三）
  assert.equal(getRegionStatus('kr', at('2027-12-27T01:00:00Z')).label, '休市') // 圣诞节（12/25 周六补休）
  assert.equal(getRegionStatus('kr', at('2027-12-31T01:00:00Z')).label, '休市') // 年末休市
})

// ---------------------------------------------------------------------------
// 行业板块数据源 / 盘面阶段（全球页「行业板块」分区，docs/美股盘前板块展示分析与改造方案.md 改动 1/2）
// ---------------------------------------------------------------------------

const session = (patch: Partial<MarketSession>): MarketSession => ({
  phase: '',
  label: '',
  useA: false,
  useUs: false,
  usMode: 'off',
  statusTone: 'rest',
  ...patch,
})

test('resolveIndustryUseA：A股时段 + 待盘前窗口取 A 股板块，其余取美股代理股', () => {
  // 2026-08-20（周四，夏令时）：A股 09:30–15:00（北京 01:30–07:00 UTC）+ 待盘前窗口 15:00–16:00（07:00–08:00 UTC）
  assert.equal(resolveIndustryUseA(null, at('2026-08-20T02:00:00Z')), true) // 北京 10:00 A股盘中
  assert.equal(resolveIndustryUseA(null, at('2026-08-20T06:30:00Z')), true) // 北京 14:30 A股盘中
  assert.equal(resolveIndustryUseA(null, at('2026-08-20T07:30:00Z')), true) // 北京 15:30 待盘前窗口
  assert.equal(resolveIndustryUseA(null, at('2026-08-20T08:00:00Z')), false) // 北京 16:00 美股盘前开始
  assert.equal(resolveIndustryUseA(null, at('2026-08-20T09:00:00Z')), false) // 北京 17:00 美股盘前
  assert.equal(resolveIndustryUseA(null, at('2026-08-20T14:30:00Z')), false) // 北京 22:30 美股盘中
  assert.equal(resolveIndustryUseA(null, at('2026-08-20T01:20:00Z')), false) // 北京 09:20 A股集合竞价 → 美股代理股
  assert.equal(resolveIndustryUseA(null, at('2026-08-22T02:00:00Z')), false) // 周六休市

  // 2026-11-02（周一，冬令时）：待盘前窗口 15:00–17:00（北京 07:00–09:00 UTC）
  assert.equal(resolveIndustryUseA(null, at('2026-11-02T08:00:00Z')), true) // 北京 16:00 待盘前窗口
  assert.equal(resolveIndustryUseA(null, at('2026-11-02T09:00:00Z')), false) // 北京 17:00 美股盘前开始

  // 显式会话优先：useA=true/useUs=false → true（周末也按 A 股口径）；useA=false/useUs=true → false
  assert.equal(
    resolveIndustryUseA(session({ useA: true, useUs: false }), at('2026-08-22T02:00:00Z')),
    true,
  )
  assert.equal(
    resolveIndustryUseA(session({ useA: false, useUs: true }), at('2026-08-20T02:00:00Z')),
    false,
  )
  // 会话未给出明确口径（useA/useUs 同真或同假）→ 回退纯时钟
  assert.equal(
    resolveIndustryUseA(session({ useA: true, useUs: true }), at('2026-08-20T02:00:00Z')),
    true,
  )
})

test('resolveIndustryPhase：阶段映射（大A盘中/午间休市/待盘前/美股盘前/盘中/盘后/休市）', () => {
  // A股时段
  assert.deepEqual(resolveIndustryPhase(session({ useA: true }), at('2026-08-20T02:00:00Z')), {
    label: '大A盘中',
    tone: 'active',
  }) // 北京 10:00
  assert.deepEqual(resolveIndustryPhase(session({ useA: true }), at('2026-08-20T04:00:00Z')), {
    label: '午间休市',
    tone: 'quiet',
  }) // 北京 12:00
  assert.deepEqual(resolveIndustryPhase(session({ useA: true }), at('2026-08-20T07:30:00Z')), {
    label: '待盘前',
    tone: 'rest',
  }) // 北京 15:30 待盘前窗口
  // 美股时段（usMode 来自会话）
  assert.deepEqual(resolveIndustryPhase(session({ usMode: 'pre' }), at('2026-08-20T09:00:00Z')), {
    label: '美股盘前',
    tone: 'quiet',
  })
  assert.deepEqual(
    resolveIndustryPhase(session({ usMode: 'regular' }), at('2026-08-20T14:30:00Z')),
    { label: '美股盘中', tone: 'active' },
  )
  assert.deepEqual(resolveIndustryPhase(session({ usMode: 'post' }), at('2026-08-20T21:00:00Z')), {
    label: '美股盘后',
    tone: 'quiet',
  })
  assert.deepEqual(resolveIndustryPhase(session({ usMode: 'off' }), at('2026-08-22T02:00:00Z')), {
    label: '休市',
    tone: 'rest',
  }) // 周六休市
  // 无会话：纯时钟回退（周末 → 休市；夏令时 16:00 盘前 → 美股盘前）
  assert.deepEqual(resolveIndustryPhase(null, at('2026-08-22T02:00:00Z')), {
    label: '休市',
    tone: 'rest',
  })
  assert.deepEqual(resolveIndustryPhase(null, at('2026-08-20T08:00:00Z')), {
    label: '美股盘前',
    tone: 'quiet',
  })
})
