import assert from 'node:assert/strict'
import test from 'node:test'

import { buildQuoteGlobalPage, type QuoteItem } from '../utils/quote-pages.ts'

const sector = (code: string, name: string, pct: number | null): QuoteItem => ({
  code,
  name,
  price: null,
  pct,
})

const index = (code: string, name: string, price: number): QuoteItem => ({
  code,
  name,
  price,
  pct: 1.2,
})

test('buildQuoteGlobalPage：A股时段标题为「中国行业板块」', () => {
  const page = buildQuoteGlobalPage({
    indices: [index('sh000001', '上证指数', 3421.5)],
    macro: [],
    sectors: [sector('BK1134', 'AI算力', 1.5)],
    statusLabel: '全球市场',
    statusTone: 'active',
    sectorBadge: 'A股时段',
    sectorTitle: '中国行业板块',
  })

  const board = page.sections.find((section) => section.id === 'industry-board')
  assert.ok(board)
  assert.equal(board.title, '中国行业板块')
  assert.equal(board.badge, 'A股时段')
  assert.ok(board.tip && board.tip.length > 0, '行业板块应附带说明文案')
})

test('buildQuoteGlobalPage：美股时段标题切换为「美股行业板块」', () => {
  const page = buildQuoteGlobalPage({
    indices: [index('usQQQ', '纳斯达克', 20000)],
    macro: [],
    sectors: [sector('BK1134', 'AI算力', 2.3)],
    statusLabel: '全球市场',
    statusTone: 'active',
    sectorBadge: '美股时段',
    sectorTitle: '美股行业板块',
  })

  const board = page.sections.find((section) => section.id === 'industry-board')
  assert.ok(board)
  assert.equal(board.title, '美股行业板块')
  assert.equal(board.badge, '美股时段')
})

test('buildQuoteGlobalPage：未传 sectorTitle 时默认「中国行业板块」', () => {
  const page = buildQuoteGlobalPage({
    indices: [],
    macro: [],
    sectors: [sector('BK0917', '半导体', null)],
    statusLabel: '全球市场',
    statusTone: 'rest',
  })

  const board = page.sections.find((section) => section.id === 'industry-board')
  assert.ok(board)
  assert.equal(board.title, '中国行业板块')
})
