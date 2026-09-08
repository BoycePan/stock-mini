import assert from 'node:assert/strict'
import test from 'node:test'

import {
  filterIndustryRows,
  parseBoardStockRows,
  parseIndustryBoardRows,
  sortIndustryRows,
  type EastmoneyBoardListBody,
  type IndustryBoardRow,
} from '../utils/industry-boards.ts'

const row = (code: string, name: string, pct: number | null): IndustryBoardRow => ({
  code,
  name,
  pct,
})

test('parseIndustryBoardRows：解析 f12/f14/f3，跳过缺代码/非BK/缺名行', () => {
  const body: EastmoneyBoardListBody = {
    data: {
      diff: [
        { f12: 'BK0464', f14: '石油石化', f3: 3.55 },
        { f12: 'BK0479', f14: '钢铁', f3: 2.37 },
        // 异常 / 噪音行应被跳过
        { f12: '', f14: '无代码', f3: 1 },
        { f12: '105.NVDA', f14: '英伟达', f3: 4.31 }, // 非 BK
        { f12: 'BK1222', f14: '', f3: 0.27 }, // 无名称
        { f12: 'BK0437', f14: '煤炭', f3: '-' }, // 无数据 → null
      ],
    },
  }
  const rows = parseIndustryBoardRows(body)
  assert.deepEqual(rows, [
    row('BK0464', '石油石化', 3.55),
    row('BK0479', '钢铁', 2.37),
    row('BK0437', '煤炭', null),
  ])
})

test('parseIndustryBoardRows：空响应/缺 data 返回空数组', () => {
  assert.deepEqual(parseIndustryBoardRows(null), [])
  assert.deepEqual(parseIndustryBoardRows({}), [])
  assert.deepEqual(parseIndustryBoardRows({ data: {} }), [])
})

test('sortIndustryRows：涨跌排序且 null 恒排最后，不修改入参', () => {
  const rows = [
    row('BK_NA', '无数据', null),
    row('BK003', '丙', 0.5),
    row('BK001', '甲', -1.2),
    row('BK002', '乙', 3.3),
  ]
  const before = rows.map((r) => r.code).join(',')
  assert.deepEqual(
    sortIndustryRows(rows, 'desc').map((r) => [r.code, r.pct]),
    [
      ['BK002', 3.3],
      ['BK003', 0.5],
      ['BK001', -1.2],
      ['BK_NA', null],
    ],
  )
  assert.deepEqual(
    sortIndustryRows(rows, 'asc').map((r) => r.code),
    ['BK001', 'BK003', 'BK002', 'BK_NA'],
  )
  // 入参未被修改
  assert.equal(rows.map((r) => r.code).join(','), before)
})

test('filterIndustryRows：按名称 / 代码（含去前缀数字）模糊过滤，空查询返回全量', () => {
  const rows = [
    row('BK1222', '影视院线', 1),
    row('BK0437', '煤炭', 2),
    row('BK0464', '石油石化', 3),
    row('BK1229', '地面兵装Ⅱ', 4),
  ]
  assert.equal(filterIndustryRows(rows, '').length, rows.length)
  assert.deepEqual(
    filterIndustryRows(rows, '煤炭').map((r) => r.code),
    ['BK0437'],
  )
  // 大小写不敏感 + 数字定位（搜 437 / 437 均命中 BK0437）
  assert.deepEqual(
    filterIndustryRows(rows, '437').map((r) => r.code),
    ['BK0437'],
  )
  assert.deepEqual(
    filterIndustryRows(rows, '影视').map((r) => r.code),
    ['BK1222'],
  )
  assert.deepEqual(filterIndustryRows(rows, '不存在'), [])
})

test('parseBoardStockRows：板块成分股解析 f12/f14/f3（A股个股不带 BK 前缀），跳过缺代码/缺名行', () => {
  const body: EastmoneyBoardListBody = {
    data: {
      diff: [
        { f12: '603679', f14: '华体科技', f3: 10.01 },
        { f12: '300911', f14: '亿田智能', f3: 6.21 },
        { f12: '920010', f14: '凯添燃气', f3: '-' }, // 无涨跌幅 → null
        // 异常 / 噪音行应被跳过
        { f12: '', f14: '无代码', f3: 1 },
        { f12: '603000', f14: '', f3: 2 },
        { f12: 'BK0464', f14: '石油石化', f3: 3.3 }, // 成分股不含板块行，此处仅验证不被排除
      ],
    },
  }
  assert.deepEqual(parseBoardStockRows(body), [
    row('603679', '华体科技', 10.01),
    row('300911', '亿田智能', 6.21),
    row('920010', '凯添燃气', null),
    row('BK0464', '石油石化', 3.3),
  ])
})

test('parseBoardStockRows：空响应/缺 data 返回空数组', () => {
  assert.deepEqual(parseBoardStockRows(null), [])
  assert.deepEqual(parseBoardStockRows({}), [])
  assert.deepEqual(parseBoardStockRows({ data: {} }), [])
})
