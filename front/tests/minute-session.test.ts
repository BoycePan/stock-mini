import assert from 'node:assert/strict'
import test from 'node:test'

import { MINUTE_SOURCES } from '../config/minute.ts'
import {
  buildMinuteGrid,
  minuteToSlot,
  minuteToTime,
  parseMinuteOfDay,
  resolveMinuteSession,
  sessionTimeLabels,
  slotToMinute,
  type MinuteSessionKind,
} from '../utils/minute-session.ts'

// ---------------------------------------------------------------------------
// parseMinuteOfDay
// ---------------------------------------------------------------------------

test('parseMinuteOfDay：HH:mm → 分钟，非法输入返回 null', () => {
  assert.equal(parseMinuteOfDay('09:30'), 570)
  assert.equal(parseMinuteOfDay('00:00'), 0)
  assert.equal(parseMinuteOfDay('15:00'), 900)
  assert.equal(parseMinuteOfDay('23:59'), 1439)
  assert.equal(parseMinuteOfDay('24:00'), null)
  assert.equal(parseMinuteOfDay('0930'), null)
  assert.equal(parseMinuteOfDay('9:30'), null)
  assert.equal(parseMinuteOfDay(''), null)
  assert.equal(parseMinuteOfDay('2026-08-20 09:30'), null)
})

// ---------------------------------------------------------------------------
// A股：固定时段网格
// ---------------------------------------------------------------------------

test('A股：完整时段 09:30-11:30 + 13:00-15:00，休盘时间不占空白（段直接相接）', () => {
  const grid = buildMinuteGrid('ashare', 999)
  assert.ok(grid)
  assert.equal(grid!.dataSlots, 242)
  assert.equal(grid!.totalSlots, 242)

  // 数据槽位：11:30 后直接接 13:00（中间无午休空槽）
  assert.equal(minuteToSlot(grid!, 570), 0) // 09:30
  assert.equal(minuteToSlot(grid!, 600), 30) // 10:00
  assert.equal(minuteToSlot(grid!, 690), 120) // 11:30
  assert.equal(minuteToSlot(grid!, 780), 121) // 13:00
  assert.equal(minuteToSlot(grid!, 900), 241) // 15:00（末槽）
  // 休盘时间（午休）无槽位，返回 null
  assert.equal(minuteToSlot(grid!, 691), null) // 11:31
  assert.equal(minuteToSlot(grid!, 779), null) // 12:59
  // 时段外返回 null
  assert.equal(minuteToSlot(grid!, 569), null)
  assert.equal(minuteToSlot(grid!, 901), null)
})

test('A股：早盘未收盘（10:00）时铺到完整时段轴，右侧自然留白', () => {
  const grid = buildMinuteGrid('ashare', 0)
  assert.ok(grid)
  // 模拟 09:30-10:00 的 31 个点
  const slots: number[] = []
  for (let m = 570; m <= 600; m += 1) {
    const slot = minuteToSlot(grid!, m)
    assert.notEqual(slot, null)
    slots.push(slot as number)
  }
  assert.deepEqual(
    slots,
    Array.from({ length: 31 }, (_, i) => i),
  )
  // 最后一点在槽位 30，而完整时段有 242 个槽位 → 右侧大部分为空白
  assert.equal(slots[slots.length - 1], 30)
  assert.ok((slots[slots.length - 1] as number) < grid!.totalSlots - 1)
})

test('A股：时间轴标签为 09:30 10:30 11:30/13:00 14:00 15:00（休盘合并为一点）', () => {
  const grid = buildMinuteGrid('ashare', 0)
  const labels = sessionTimeLabels(grid!)
  assert.deepEqual(
    labels.map((l) => l.text),
    ['09:30', '10:30', '11:30/13:00', '14:00', '15:00'],
  )
  // 槽位单调递增且覆盖首尾
  const slots = labels.map((l) => l.slot)
  assert.deepEqual(
    slots,
    [...slots].sort((a, b) => a - b),
  )
  assert.equal(slots[0], 0)
  assert.equal(slots[slots.length - 1], 241)
})

// ---------------------------------------------------------------------------
// 锚定类时段（以首个数据点时间为锚点，适配跨零点与夏令时）
// ---------------------------------------------------------------------------

test('美股：以首点为锚 09:30-16:00 ET（北京时间 21:30-04:00），跨零点正确换算', () => {
  const grid = buildMinuteGrid('us', 21 * 60 + 30)
  assert.ok(grid)
  assert.equal(grid!.totalSlots, 391)
  assert.equal(grid!.dataSlots, 391)
  // 21:30 → 槽 0；00:00（早于锚点）→ 槽 150；04:00 → 槽 390
  assert.equal(minuteToSlot(grid!, 21 * 60 + 30), 0)
  assert.equal(minuteToSlot(grid!, 0), 150)
  assert.equal(minuteToSlot(grid!, 4 * 60), 390)
  // 标签首尾
  const labels = sessionTimeLabels(grid!)
  assert.equal(labels[0]!.text, '21:30')
  assert.equal(labels[labels.length - 1]!.text, '04:00')
})

test('韩股：09:00-15:30 KST 连续段（北京时间 08:00-14:30）', () => {
  const grid = buildMinuteGrid('kr', 8 * 60)
  assert.ok(grid)
  assert.equal(grid!.totalSlots, 391)
  assert.equal(minuteToSlot(grid!, 8 * 60), 0)
  assert.equal(minuteToSlot(grid!, 14 * 60 + 30), 390)
})

test('印度：09:15-15:30 IST（北京时间 11:45-18:00）', () => {
  const grid = buildMinuteGrid('in', 11 * 60 + 45)
  assert.ok(grid)
  assert.equal(grid!.totalSlots, 376)
  assert.equal(minuteToSlot(grid!, 11 * 60 + 45), 0)
  assert.equal(minuteToSlot(grid!, 18 * 60), 375)
})

test('日本：东财口径（N225）午后到 15:30 JST，Yahoo 日股午后到 15:00 JST', () => {
  // 东财 N225：北京时间 08:00-10:30 + 11:30-14:30（休盘不占槽位）
  const em = buildMinuteGrid('jp-em', 8 * 60)
  assert.ok(em)
  assert.equal(em!.dataSlots, 332)
  assert.equal(em!.totalSlots, 332)
  assert.equal(minuteToSlot(em!, 8 * 60), 0)
  assert.equal(minuteToSlot(em!, 10 * 60 + 30), 150)
  assert.equal(minuteToSlot(em!, 10 * 60 + 31), null) // 午休
  assert.equal(minuteToSlot(em!, 11 * 60 + 30), 151)
  assert.equal(minuteToSlot(em!, 14 * 60 + 30), 331)

  // Yahoo 日股：北京时间 08:00-10:30 + 11:30-14:00
  const yahoo = buildMinuteGrid('jp-yahoo', 8 * 60)
  assert.ok(yahoo)
  assert.equal(yahoo!.dataSlots, 302)
  assert.equal(yahoo!.totalSlots, 302)
  assert.equal(minuteToSlot(yahoo!, 14 * 60), 301)
})

test('越南：09:15-11:30 + 13:00-15:00 ICT（北京时间 10:15-16:00，休盘不占槽位）', () => {
  const grid = buildMinuteGrid('vn', 10 * 60 + 15)
  assert.ok(grid)
  assert.equal(grid!.dataSlots, 257)
  assert.equal(grid!.totalSlots, 257)
  assert.equal(minuteToSlot(grid!, 10 * 60 + 15), 0)
  assert.equal(minuteToSlot(grid!, 12 * 60 + 30), 135)
  assert.equal(minuteToSlot(grid!, 12 * 60 + 31), null) // 午休
  assert.equal(minuteToSlot(grid!, 14 * 60), 136)
  assert.equal(minuteToSlot(grid!, 16 * 60), 256)
})

test('continuous 或无意义 kind：buildMinuteGrid 返回 null', () => {
  assert.equal(buildMinuteGrid('continuous', 0), null)
  assert.equal(buildMinuteGrid('' as MinuteSessionKind, 0), null)
})

test('slotToMinute / minuteToTime：槽位与分钟互转（含跨零点取模）', () => {
  const grid = buildMinuteGrid('us', 21 * 60 + 30)
  assert.ok(grid)
  assert.equal(slotToMinute(grid!, 0), 21 * 60 + 30)
  assert.equal(slotToMinute(grid!, 390), 4 * 60)
  assert.equal(slotToMinute(grid!, 391), null) // 越界空槽
  assert.equal(minuteToTime(21 * 60 + 30), '21:30')
  assert.equal(minuteToTime(4 * 60), '04:00')
  assert.equal(minuteToTime(1440), '00:00')
  assert.equal(minuteToTime(1680), '04:00')
})

// ---------------------------------------------------------------------------
// resolveMinuteSession：配置覆盖检查
// ---------------------------------------------------------------------------

test('resolveMinuteSession：关键标的分类', () => {
  assert.equal(resolveMinuteSession('sh000001'), 'ashare')
  assert.equal(resolveMinuteSession('sz399006'), 'ashare')
  assert.equal(resolveMinuteSession('BK1134'), 'ashare')
  assert.equal(resolveMinuteSession('AVG'), 'ashare')
  assert.equal(resolveMinuteSession('TPX'), 'ashare')
  assert.equal(resolveMinuteSession('TUNGSTEN'), 'ashare')
  assert.equal(resolveMinuteSession('usDJI'), 'us')
  assert.equal(resolveMinuteSession('usSPY'), 'us')
  assert.equal(resolveMinuteSession('us-BK1134'), 'us')
  assert.equal(resolveMinuteSession('TLT'), 'us')
  assert.equal(resolveMinuteSession('SOX'), 'us')
  assert.equal(resolveMinuteSession('KS11'), 'kr')
  assert.equal(resolveMinuteSession('KQ11'), 'kr')
  assert.equal(resolveMinuteSession('N225'), 'jp-em')
  assert.equal(resolveMinuteSession('SENSEX'), 'in')
  assert.equal(resolveMinuteSession('VNINDEX'), 'vn')
  // 韩/日个股依赖 Yahoo 符号后缀
  assert.equal(resolveMinuteSession('005930'), 'kr')
  assert.equal(resolveMinuteSession('8035'), 'jp-yahoo')
  // 连续交易标的
  assert.equal(resolveMinuteSession('GC'), 'continuous')
  assert.equal(resolveMinuteSession('GOLD'), 'continuous')
  assert.equal(resolveMinuteSession('GOLD-US'), 'continuous')
  assert.equal(resolveMinuteSession('USDCNY'), 'continuous')
  assert.equal(resolveMinuteSession('BRT'), 'continuous')
  assert.equal(resolveMinuteSession('VIX'), 'continuous')
  assert.equal(resolveMinuteSession('UDI'), 'continuous')
  assert.equal(resolveMinuteSession(''), 'continuous')
  assert.equal(resolveMinuteSession('NOT_EXIST'), 'continuous')
})

test('resolveMinuteSession：MINUTE_SOURCES 全部条目都有合理分类（防止新增标的漏配）', () => {
  const expected: Record<string, MinuteSessionKind> = {
    // 全球页 · A股指数 / 美股指数
    sh000001: 'ashare',
    sz399001: 'ashare',
    sz399006: 'ashare',
    sh000688: 'ashare',
    AVG: 'ashare',
    usDJI: 'us',
    usSPY: 'us',
    usQQQ: 'us',
    // 全球页 · 宏观经济
    BRT: 'continuous',
    VIX: 'continuous',
    UDI: 'continuous',
    TLT: 'us',
    GC: 'continuous',
    SI: 'continuous',
    HG: 'continuous',
    NG: 'continuous',
    SOX: 'us',
    // 全球页 · 行业板块（东财板块指数，A股时段）
    BK1134: 'ashare',
    BK1128: 'ashare',
    BK0917: 'ashare',
    BK1137: 'ashare',
    BK0922: 'ashare',
    BK0579: 'ashare',
    BK0963: 'ashare',
    BK0921: 'ashare',
    BK1090: 'ashare',
    BK0802: 'ashare',
    BK0577: 'ashare',
    BK1647: 'ashare',
    BK0490: 'ashare',
    BK0493: 'ashare',
    BK0588: 'ashare',
    BK0574: 'ashare',
    BK0464: 'ashare',
    BK0843: 'ashare',
    BK0478: 'ashare',
    BK0547: 'ashare',
    BK0475: 'ashare',
    BK1216: 'ashare',
    BK0438: 'ashare',
    BK1016: 'ashare',
    // 日韩页 · 指数
    KS11: 'kr',
    KQ11: 'kr',
    N225: 'jp-em',
    TPX: 'ashare',
    VNINDEX: 'vn',
    SENSEX: 'in',
    // 日韩页 · 个股（Yahoo）
    '005930': 'kr',
    '000660': 'kr',
    '373220': 'kr',
    '066570': 'kr',
    '035420': 'kr',
    '005380': 'kr',
    '068270': 'kr',
    '051910': 'kr',
    '8035': 'jp-yahoo',
    '6954': 'jp-yahoo',
    '6861': 'jp-yahoo',
    '7203': 'jp-yahoo',
    '6758': 'jp-yahoo',
    '4063': 'jp-yahoo',
    '6981': 'jp-yahoo',
    '7974': 'jp-yahoo',
    // 日韩页 · 汇率
    CNYKRW: 'continuous',
    CNYJPY: 'continuous',
    USDKRW: 'continuous',
    USDJPY: 'continuous',
    USDCNY: 'continuous',
    // 有色页 · 沪主连（含夜盘，近似连续）
    GOLD: 'continuous',
    SILVER: 'continuous',
    COPPER: 'continuous',
    ALUMINUM: 'continuous',
    ZINC: 'continuous',
    NICKEL: 'continuous',
    TIN: 'continuous',
    // 有色页 · 外盘 COMEX
    'GOLD-US': 'continuous',
    'SILVER-US': 'continuous',
    'COPPER-US': 'continuous',
    // 有色页 · A股个股代理
    TUNGSTEN: 'ashare',
    MOLY: 'ashare',
    GERMANIUM: 'ashare',
    INDIUM: 'ashare',
    ANTIMONY: 'ashare',
  }
  // 美股时段行业板块（us-BKxxxx，代理股合成，美股时段）
  const usBoards = Object.keys(MINUTE_SOURCES).filter((code) => code.startsWith('us-'))
  for (const code of usBoards) {
    expected[code] = 'us'
  }

  const keys = Object.keys(MINUTE_SOURCES)
  assert.ok(keys.length > 80, `配置条目数量异常: ${keys.length}`)
  for (const code of keys) {
    const want = expected[code]
    assert.ok(want, `测试缺少 ${code} 的期望分类`)
    assert.equal(resolveMinuteSession(code), want, `分类不符: ${code}`)
  }
})
