import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildQuoteAsiaPage,
  buildQuoteGlobalPage,
  buildQuoteMetalsPage,
  type QuoteItem,
} from '../utils/quote-pages.ts'

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
    cnIndices: [index('sh000001', '上证指数', 3421.5)],
    usIndices: [],
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
  assert.equal(board.minuteCorner, true, '行业板块应以面板右上角角标提示分时')
  assert.ok(board.tip && board.tip.length > 0, '行业板块应附带说明文案')
  assert.ok(board.tip.includes('中国行业板块'), '提示应说明中国行业板块的展示时段')
  assert.ok(board.tip.includes('美股行业板块'), '提示应说明美股行业板块的展示时段')
  assert.ok(
    board.tip.includes('09:30') && board.tip.includes('15:00'),
    '提示应给出中国/美股展示的切换时间点',
  )
})

test('buildQuoteGlobalPage：美股时段标题切换为「美股行业板块」且透传分时代码', () => {
  const page = buildQuoteGlobalPage({
    cnIndices: [],
    usIndices: [index('usQQQ', '纳斯达克', 20000)],
    macro: [],
    // 美股时段板块由 api 层标记分时代码（us-BKxxxx → 代理股均值合成分时，见 api/market.ts）
    sectors: [
      {
        ...sector('BK1134', 'AI算力', 2.3),
        minuteCode: 'us-BK1134',
      },
    ],
    statusLabel: '全球市场',
    statusTone: 'active',
    sectorBadge: '美股时段',
    sectorTitle: '美股行业板块',
  })

  const board = page.sections.find((section) => section.id === 'industry-board')
  assert.ok(board)
  assert.equal(board.title, '美股行业板块')
  assert.equal(board.badge, '美股时段')
  assert.equal(board.minuteCorner, true, '美股时段板块同样支持代理股合成分时，应展示「分时」角标')
  const metric = board.metrics[0]
  assert.ok(metric, '美股时段板块应包含指标')
  assert.equal(metric.minuteCode, 'us-BK1134', '美股时段板块应透传代理股合成分时代码')
})

test('buildQuoteGlobalPage：未传 sectorTitle 时默认「中国行业板块」', () => {
  const page = buildQuoteGlobalPage({
    cnIndices: [],
    usIndices: [],
    macro: [],
    sectors: [sector('BK0917', '半导体', null)],
    statusLabel: '全球市场',
    statusTone: 'rest',
  })

  const board = page.sections.find((section) => section.id === 'industry-board')
  assert.ok(board)
  assert.equal(board.title, '中国行业板块')
})

test('buildQuoteGlobalPage：全球指数按市场拆分为「中国指数」「美股指数」两个分区', () => {
  const page = buildQuoteGlobalPage({
    cnIndices: [
      index('sh000001', '上证指数', 3421.5),
      index('sz399001', '深证成指', 10850.2),
      { code: 'AVG', name: 'A股平均股价', price: 21.33, pct: 0.5 },
    ],
    usIndices: [index('usDJI', '道琼斯工业', 44150.6), index('usQQQ', '纳斯达克', 20000)],
    macro: [],
    sectors: [],
    statusLabel: '全球市场',
    statusTone: 'active',
  })

  assert.deepEqual(
    page.sections.map((section) => [section.id, section.title]),
    [
      ['cn-index', 'A股指数'],
      ['us-index', '美股指数'],
    ],
  )
  assert.equal(page.sections[0]?.metrics.length, 3, '中国指数分区应包含 A 股指数与平均股价')
  assert.equal(page.sections[0]?.metrics[2]?.name, 'A股平均股价')
  assert.equal(page.sections[1]?.metrics.length, 2)
  assert.equal(page.sections[1]?.metrics[0]?.name, '道琼斯工业')
})

test('buildQuoteGlobalPage：某市场指数为空时对应分区不展示', () => {
  const page = buildQuoteGlobalPage({
    cnIndices: [index('sh000001', '上证指数', 3421.5)],
    usIndices: [],
    macro: [],
    sectors: [],
    statusLabel: '全球市场',
    statusTone: 'active',
  })

  assert.deepEqual(
    page.sections.map((section) => section.title),
    ['A股指数'],
  )
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

// ---------------------------------------------------------------------------
// 板块标题右侧盘面状态（A股 / 美股 / 日韩）
// ---------------------------------------------------------------------------

test('buildQuoteGlobalPage：A股指数 / 美股指数 板块附加盘面状态', () => {
  // 2026-08-20 02:00 UTC = 北京 10:00（盘中）、美东 8/19 22:00（休市）
  const page = buildQuoteGlobalPage(
    {
      cnIndices: [index('sh000001', '上证指数', 3421.5)],
      usIndices: [index('usQQQ', '纳斯达克', 20000)],
      macro: [{ code: 'VIX', name: '恐慌指数', price: 18.5, pct: -2 }],
      sectors: [],
      statusLabel: '全球市场',
      statusTone: 'active',
    },
    new Date('2026-08-20T02:00:00Z'),
  )

  const cn = page.sections.find((section) => section.id === 'cn-index')
  const us = page.sections.find((section) => section.id === 'us-index')
  assert.ok(cn)
  assert.ok(us)
  assert.equal(cn.marketStatus, '盘中')
  assert.equal(cn.marketTone, 'active')
  assert.equal(us.marketStatus, '休市')
  assert.equal(us.marketTone, 'rest')
  // 无 region 的板块不展示盘面状态
  const economy = page.sections.find((section) => section.id === 'global-economy')
  assert.ok(economy)
  assert.equal(economy.marketStatus, undefined)
})

test('buildQuoteGlobalPage：美股盘中时段状态为「盘中」', () => {
  // 2026-08-20 14:30 UTC = 美东 10:30（盘中）、北京 22:30（休市）
  const page = buildQuoteGlobalPage(
    {
      cnIndices: [index('sh000001', '上证指数', 3421.5)],
      usIndices: [index('usQQQ', '纳斯达克', 20000)],
      macro: [],
      sectors: [],
      statusLabel: '全球市场',
      statusTone: 'active',
    },
    new Date('2026-08-20T14:30:00Z'),
  )

  const us = page.sections.find((section) => section.id === 'us-index')
  const cn = page.sections.find((section) => section.id === 'cn-index')
  assert.ok(us)
  assert.ok(cn)
  assert.equal(us.marketStatus, '盘中')
  assert.equal(us.marketTone, 'active')
  assert.equal(cn.marketStatus, '休市')
})

test('buildQuoteAsiaPage：韩国/日本板块附加盘面状态，午休与无午休区分', () => {
  const jpIndex: QuoteItem = { code: 'N225', name: '日经225', price: 40000, pct: 1 }
  const krIndex: QuoteItem = { code: 'KS11', name: 'KOSPI', price: 3000, pct: 1 }

  // 2026-08-20 03:00 UTC = 东京/首尔 12:00：日股午休、韩股无午休仍盘中
  const page = buildQuoteAsiaPage(
    {
      indexGroups: [
        { id: 'asia-jp-index', title: '日本指数', items: [jpIndex], region: 'jp' },
        { id: 'asia-kr-index', title: '韩国指数', items: [krIndex], region: 'kr' },
      ],
      stockGroups: [],
      rates: [],
      statusTone: 'active',
    },
    new Date('2026-08-20T03:00:00Z'),
  )

  const jp = page.sections.find((section) => section.id === 'asia-jp-index')
  const kr = page.sections.find((section) => section.id === 'asia-kr-index')
  assert.ok(jp)
  assert.ok(kr)
  assert.equal(jp.marketStatus, '午休')
  assert.equal(jp.marketTone, 'quiet')
  assert.equal(kr.marketStatus, '盘中')
  assert.equal(kr.marketTone, 'active')

  // 2026-06-03（韩国地方选举日）→ 韩股休市
  const electionDay = buildQuoteAsiaPage(
    {
      indexGroups: [{ id: 'asia-kr-index', title: '韩国指数', items: [krIndex], region: 'kr' }],
      stockGroups: [],
      rates: [],
      statusTone: 'active',
    },
    new Date('2026-06-03T01:00:00Z'),
  )
  const krHoliday = electionDay.sections.find((section) => section.id === 'asia-kr-index')
  assert.ok(krHoliday)
  assert.equal(krHoliday.marketStatus, '休市')
  assert.equal(krHoliday.marketTone, 'rest')
})
