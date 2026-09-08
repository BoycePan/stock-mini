import assert from 'node:assert/strict'
import test from 'node:test'

import {
  US_CONCEPT_BOARDS,
  US_INDUSTRY_BOARDS,
  usBoardByCode,
  usBoardProxiesOf,
  usBoardsOf,
} from '../config/us-board-catalog.ts'
import { filterUsBoardRows, type UsBoardRow } from '../utils/us-boards.ts'

/** 成分 secid 合法形态：105/106/107.代码 */
const PROXY_RE = /^(105|106|107)\.[A-Z][A-Z0-9._]*$/i

test('美股目录：概念/行业数量与总数落在合理区间', () => {
  assert.ok(US_CONCEPT_BOARDS.length >= 35, '概念应不少于 35 项')
  assert.ok(US_INDUSTRY_BOARDS.length >= 30, '行业应不少于 30 项')
  const total = US_CONCEPT_BOARDS.length + US_INDUSTRY_BOARDS.length
  assert.ok(total >= 70 && total <= 95, `目录总数 ${total} 应在 70-95 项`)
})

test('美股目录：板块 code 全局唯一、成分为合法东财 secid、单板块无重复成分', () => {
  const codes = new Set<string>()
  for (const board of [...US_CONCEPT_BOARDS, ...US_INDUSTRY_BOARDS]) {
    assert.ok(!codes.has(board.code), `code 重复: ${board.code}`)
    codes.add(board.code)
    assert.ok(board.name.length > 0, `${board.code} 缺名称`)
    assert.ok(board.proxies.length >= 2, `${board.code} 成分应 ≥2 只`)
    const seen = new Set(board.proxies)
    assert.equal(seen.size, board.proxies.length, `${board.code} 成分重复`)
    for (const proxy of board.proxies) {
      assert.match(proxy, PROXY_RE, `${board.code} 非法成分 ${proxy}`)
    }
  }
})

test('usBoardsOf / usBoardByCode：分类取数与 code 还原正确', () => {
  assert.equal(usBoardsOf('concept'), US_CONCEPT_BOARDS)
  assert.equal(usBoardsOf('industry'), US_INDUSTRY_BOARDS)
  const ai = US_CONCEPT_BOARDS[0]
  assert.ok(ai, '概念目录应非空')
  assert.equal(usBoardByCode(ai.code), ai)
  assert.equal(usBoardByCode('not-exist'), null)
})

test('usBoardProxiesOf：去重且与目录成分一致（每个代理都可还原到某板块）', () => {
  const conceptProxies = usBoardProxiesOf('concept')
  const industryProxies = usBoardProxiesOf('industry')
  assert.equal(new Set(conceptProxies).size, conceptProxies.length, 'concept 成分应去重')
  assert.equal(new Set(industryProxies).size, industryProxies.length, 'industry 成分应去重')
  assert.ok(conceptProxies.length > 0 && industryProxies.length > 0)
  for (const proxy of [...conceptProxies, ...industryProxies]) {
    assert.match(proxy, PROXY_RE)
  }
})

const row = (code: string, name: string, proxies: string[]): UsBoardRow => ({
  code,
  name,
  pct: null,
  proxies,
})

test('filterUsBoardRows：按名称 / 成分代码过滤，空查询返回全量', () => {
  const rows = [
    row('usc-ai-compute', 'AI算力', ['105.NVDA', '105.AMD', '105.AVGO']),
    row('usc-glp1', '减肥药(GLP-1)', ['106.LLY', '106.NVO']),
    row('usi-banks', '银行', ['106.JPM', '106.BAC']),
  ]
  assert.equal(filterUsBoardRows(rows, '').length, rows.length)
  assert.deepEqual(
    filterUsBoardRows(rows, '银行').map((r) => r.code),
    ['usi-banks'],
  )
  // 成分代码命中（大小写不敏感）：nvda → AI算力
  assert.deepEqual(
    filterUsBoardRows(rows, 'nvda').map((r) => r.code),
    ['usc-ai-compute'],
  )
  // 名称命中（AI / 减肥）
  assert.deepEqual(
    filterUsBoardRows(rows, '减肥').map((r) => r.code),
    ['usc-glp1'],
  )
  assert.deepEqual(filterUsBoardRows(rows, '不存在'), [])
})
