import assert from 'node:assert/strict'
import test from 'node:test'

import { buildQuoteGlobalPage, buildQuoteMetalsPage, type QuoteItem } from '../utils/quote-pages.ts'

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

test('buildQuoteMetalsPage：指标透传「个股」+金属 tags，分组透传 tip', () => {
  const page = buildQuoteMetalsPage({
    groups: [
      {
        id: 'metal-other',
        title: '其他金属',
        tip: '钼/锗/铟/锑暂无统一现货报价，展示的是对应 A 股上市公司（个股）的股价',
        items: [
          { code: 'TUNGSTEN', name: '钨', price: 328.5, pct: 1.2 },
          { code: 'MOLY', name: '洛阳钼业', price: 18.82, pct: -1.62, tags: ['个股', '钼'] },
        ],
      },
    ],
    statusTone: 'active',
  })

  const other = page.sections.find((section) => section.id === 'metal-other')
  assert.ok(other)
  assert.equal(other.tip, '钼/锗/铟/锑暂无统一现货报价，展示的是对应 A 股上市公司（个股）的股价')
  assert.equal(other.metrics[0]?.tags, undefined, '金属报价不加标签')
  assert.deepEqual(other.metrics[1]?.tags, ['个股', '钼'], '个股来源需标「个股」+ 所代表金属')
  assert.equal(other.metrics[1]?.name, '洛阳钼业')
})
