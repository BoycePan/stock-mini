import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildQuoteAsiaPage,
  buildQuoteGlobalPage,
  buildQuoteMetalsPage,
  type QuoteGlobalSectorTab,
  type QuoteItem,
} from '../utils/quote-pages.ts'

const sector = (code: string, name: string, pct: number | null): QuoteItem => ({
  code,
  name,
  price: null,
  pct,
})

/** 行业板块面板的单个 Tab（A股 / 美股）测试数据 */
const sectorTab = (
  key: string,
  label: string,
  items: QuoteItem[],
  phase: QuoteGlobalSectorTab['phase'],
  minuteCorner = true,
): QuoteGlobalSectorTab => ({ key, label, items, phase, minuteCorner })

const index = (code: string, name: string, price: number): QuoteItem => ({
  code,
  name,
  price,
  pct: 1.2,
})

test('buildQuoteGlobalPage：featured 入口卡透传 featured/featuredDesc 到 metric', () => {
  const page = buildQuoteGlobalPage({
    cnIndices: [],
    usIndices: [
      index('usIXIC', '纳斯达克', 20000),
      {
        code: 'us-top100',
        name: '美股市值TOP100',
        price: null,
        pct: null,
        valueText: '查看',
        hideChange: true,
        hideFromPoster: true,
        featured: true,
        featuredDesc: '美股三大市场 · 市值前100个股',
        iconImage: '/static/icons/emoji/1f1fa-1f1f8.png',
      },
    ],
    macro: [],
    sectorTabs: [],
    statusLabel: '全球市场',
    statusTone: 'active',
  })

  const section = page.sections.find((s) => s.id === 'us-index')
  assert.ok(section)
  const metric = section.metrics.find((m) => m.code === 'us-top100')
  assert.ok(metric, '美股指数区应包含 us-top100 入口卡')
  assert.equal(metric.featured, true)
  assert.equal(metric.featuredDesc, '美股三大市场 · 市值前100个股')
  assert.equal(metric.iconImage, '/static/icons/emoji/1f1fa-1f1f8.png', '入口卡应带美国国旗图片')
  assert.equal(metric.hideChange, true)
  assert.equal(metric.hideFromPoster, true)
  assert.equal(metric.value, '查看')
})

test('buildQuoteGlobalPage：行业板块标题固定为「行业板块」且按默认 Tab 投影 A股数据', () => {
  const page = buildQuoteGlobalPage({
    cnIndices: [index('sh000001', '上证指数', 3421.5)],
    usIndices: [],
    macro: [],
    // 数据层同时备好两个 Tab：A股（东财板块涨跌幅）+ 美股（代理股均值）
    sectorTabs: [
      sectorTab('a', 'A股', [sector('BK1134', 'AI算力', 1.5)], {
        label: '大A盘中',
        tone: 'active',
      }),
      sectorTab('us', '美股', [{ ...sector('BK1134', 'AI算力', 2.3), minuteCode: 'us-BK1134' }], {
        label: '休市',
        tone: 'rest',
      }),
    ],
    // 时段默认：A股时段 → 'a'
    sectorActiveTab: 'a',
    statusLabel: '全球市场',
    statusTone: 'active',
  })

  const board = page.sections.find((section) => section.id === 'industry-board')
  assert.ok(board)
  assert.equal(board.title, '行业板块', '面板标题不再随会话切换（原「中国/美股行业板块」）')
  assert.equal(board.activeTab, 'a', '默认选中 Tab 应取数据层按时段规则判定的值')
  assert.deepEqual(
    board.tabs?.map((tab) => [tab.key, tab.label]),
    [
      ['a', 'A股'],
      ['us', '美股'],
    ],
    '面板应带 A股 / 美股 两个 Tab（渲染层只需 key / label）',
  )
  // Tab 自带该市场的阶段短文案（渲染在 Tab 上：A股 ● 盘中 / 美股 ● 休市），两个市场一眼可比；
  // 短文案不带市场前缀（Tab 标签已写明 A股 / 美股）
  assert.equal(board.tabs?.[0]?.marketStatusShort, '盘中')
  assert.equal(board.tabs?.[0]?.marketTone, 'active')
  assert.equal(board.tabs?.[1]?.marketStatusShort, '休市')
  assert.equal(board.tabs?.[1]?.marketTone, 'rest')
  assert.equal(board.marketStatus, '大A盘中', '阶段化胶囊取当前选中 Tab 的市场阶段')
  assert.equal(board.marketTone, 'active')
  assert.equal(board.minuteCorner, true, 'A股 Tab 支持板块分时，应展示「分时」角标')
  assert.equal(board.metrics[0]?.change, 1.5, '分区指标应为选中 Tab（A股）的数据')
  // Tab 数据里各带一份该市场的指标（页面切 Tab 时投影，无需重新请求）
  assert.equal(
    board.tabs?.[1]?.metrics?.[0]?.minuteCode,
    'us-BK1134',
    '美股 Tab 应带代理股合成分时',
  )
  assert.ok(board.tip && board.tip.length > 0, '行业板块应附带说明文案')
  assert.ok(board.tip.includes('A股') && board.tip.includes('美股'), '提示应说明两个市场的口径')
  assert.ok(
    board.tip.includes('09:15') && (board.tip.includes('21:30') || board.tip.includes('22:30')),
    '提示应给出默认选中 A股 / 美股的时间点',
  )
})

test('buildQuoteGlobalPage：美股时段默认选中美股 Tab 且透传代理股分时代码', () => {
  const page = buildQuoteGlobalPage({
    cnIndices: [],
    usIndices: [index('usIXIC', '纳斯达克', 20000)],
    macro: [],
    // 美股时段板块由 api 层标记分时代码（us-BKxxxx → 代理股均值合成分时，见 api/market.ts）
    sectorTabs: [
      sectorTab('a', 'A股', [sector('BK1134', 'AI算力', 1.5)], { label: '休市', tone: 'rest' }),
      sectorTab('us', '美股', [{ ...sector('BK1134', 'AI算力', 2.3), minuteCode: 'us-BK1134' }], {
        label: '美股盘中',
        tone: 'active',
      }),
    ],
    // 时段默认：美股盘中 → 'us'
    sectorActiveTab: 'us',
    statusLabel: '全球市场',
    statusTone: 'active',
  })

  const board = page.sections.find((section) => section.id === 'industry-board')
  assert.ok(board)
  assert.equal(board.title, '行业板块')
  assert.equal(board.activeTab, 'us')
  assert.equal(board.marketStatus, '美股盘中', '行业板块应展示阶段化胶囊（美股时段 → 美股盘中）')
  assert.equal(board.marketTone, 'active')
  assert.equal(board.minuteCorner, true, '美股时段板块同样支持代理股合成分时，应展示「分时」角标')
  const metric = board.metrics[0]
  assert.ok(metric, '美股时段板块应包含指标')
  assert.equal(metric.minuteCode, 'us-BK1134', '美股时段板块应透传代理股合成分时代码')
})

test('buildQuoteGlobalPage：美股盘前默认选中美股 Tab、无分时角标、点击提示', () => {
  const page = buildQuoteGlobalPage({
    cnIndices: [],
    usIndices: [index('usIXIC', '纳斯达克', 20000)],
    macro: [],
    // 盘前板块由 api 层标记无源占位分时代码（us-pre-BKxxxx → hasMinuteSources=false）
    sectorTabs: [
      sectorTab('a', 'A股', [sector('BK1134', 'AI算力', 1.5)], { label: '休市', tone: 'rest' }),
      sectorTab(
        'us',
        '美股',
        [
          {
            ...sector('BK1134', 'AI算力', 0.23),
            minuteCode: 'us-pre-BK1134',
            minuteUnavailableTip: '盘前仅支持查看参考涨跌幅，暂不支持分时图',
          },
        ],
        { label: '美股盘前', tone: 'quiet' },
        false,
      ),
    ],
    // 盘前时段 → 默认选中美股 Tab
    sectorActiveTab: 'us',
    statusLabel: '全球市场',
    statusTone: 'rest',
  })

  const board = page.sections.find((section) => section.id === 'industry-board')
  assert.ok(board)
  assert.equal(board.title, '行业板块')
  assert.equal(board.activeTab, 'us')
  assert.equal(board.marketStatus, '美股盘前', '盘前时段应展示「美股盘前」阶段化胶囊')
  assert.equal(board.marketTone, 'quiet')
  assert.equal(board.minuteCorner, false, '盘前仅支持参考涨跌幅，不应展示「分时」角标')
  const metric = board.metrics[0]
  assert.ok(metric)
  assert.equal(metric.minuteCode, 'us-pre-BK1134', '盘前板块应透传无源占位分时代码')
  assert.equal(
    metric.minuteUnavailableTip,
    '盘前仅支持查看参考涨跌幅，暂不支持分时图',
    '盘前点击卡片应给出不支持分时的提示文案',
  )
  assert.ok(board.tip && board.tip.includes('盘前'), 'tip 应说明美股盘前时段的展示口径')
  // A股 Tab 数据同时备好（用户可手动切到 A股查看当日收盘涨跌幅）
  assert.equal(board.tabs?.[0]?.metrics?.[0]?.change, 1.5)
  assert.equal(board.tabs?.[0]?.minuteCorner, true, 'A股 Tab 仍有板块分时，切过去应恢复角标')
})

test('buildQuoteGlobalPage：未传 sectorTabs 时不展示行业板块分区；缺省取第一个 Tab', () => {
  const page = buildQuoteGlobalPage({
    cnIndices: [],
    usIndices: [],
    macro: [],
    sectorTabs: [],
    statusLabel: '全球市场',
    statusTone: 'rest',
  })

  assert.equal(
    page.sections.find((section) => section.id === 'industry-board'),
    undefined,
    '无板块数据时不展示行业板块分区',
  )

  // 未传 sectorActiveTab（或传入未声明的键）→ 回退第一个 Tab
  const fallback = buildQuoteGlobalPage({
    cnIndices: [],
    usIndices: [],
    macro: [],
    sectorTabs: [
      sectorTab('a', 'A股', [sector('BK0917', '半导体', null)], { label: '休市', tone: 'rest' }),
      sectorTab('us', '美股', [sector('BK0917', '半导体', 1.1)], {
        label: '美股盘中',
        tone: 'active',
      }),
    ],
    statusLabel: '全球市场',
    statusTone: 'rest',
  })
  const board = fallback.sections.find((section) => section.id === 'industry-board')
  assert.ok(board)
  assert.equal(board.activeTab, 'a')
  assert.equal(board.marketStatus, '休市')
})

test('buildQuoteGlobalPage：全球指数按市场拆分为「中国指数」「美股指数」两个分区', () => {
  const page = buildQuoteGlobalPage({
    cnIndices: [
      index('sh000001', '上证指数', 3421.5),
      index('sz399001', '深证成指', 10850.2),
      { code: 'AVG', name: 'A股平均股价', price: 21.33, pct: 0.5 },
    ],
    usIndices: [index('usDJI', '道琼斯工业', 44150.6), index('usIXIC', '纳斯达克', 20000)],
    macro: [],
    sectorTabs: [],
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
    sectorTabs: [],
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
      usIndices: [index('usIXIC', '纳斯达克', 20000)],
      macro: [{ code: 'VIX', name: '恐慌指数', price: 18.5, pct: -2 }],
      sectorTabs: [],
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
      usIndices: [index('usIXIC', '纳斯达克', 20000)],
      macro: [],
      sectorTabs: [],
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

test('buildQuoteGlobalPage：行业板块阶段化胶囊随选中 Tab 切换', () => {
  const tabs = [
    sectorTab('a', 'A股', [sector('BK1134', 'AI算力', 1.5)], { label: '大A盘中', tone: 'active' }),
    sectorTab('us', '美股', [sector('BK1134', 'AI算力', 2.3)], {
      label: '美股盘后',
      tone: 'quiet',
    }),
  ]

  // A股时段 → 默认 A股 Tab，胶囊为大A阶段
  const aPage = buildQuoteGlobalPage({
    cnIndices: [index('sh000001', '上证指数', 3421.5)],
    usIndices: [index('usIXIC', '纳斯达克', 20000)],
    macro: [],
    sectorTabs: tabs,
    sectorActiveTab: 'a',
    statusLabel: '全球市场',
    statusTone: 'active',
  })
  const aBoard = aPage.sections.find((section) => section.id === 'industry-board')
  assert.ok(aBoard)
  assert.equal(aBoard.marketStatus, '大A盘中')
  assert.equal(aBoard.marketTone, 'active')

  // 美股时段 → 默认美股 Tab，胶囊为美股阶段（同一份 tabs 数据，只换默认选中）
  const usPage = buildQuoteGlobalPage({
    cnIndices: [],
    usIndices: [index('usIXIC', '纳斯达克', 20000)],
    macro: [],
    sectorTabs: tabs,
    sectorActiveTab: 'us',
    statusLabel: '全球市场',
    statusTone: 'rest',
  })
  const usBoard = usPage.sections.find((section) => section.id === 'industry-board')
  assert.ok(usBoard)
  assert.equal(usBoard.marketStatus, '美股盘后')
  assert.equal(usBoard.marketTone, 'quiet')
  assert.equal(usBoard.metrics[0]?.change, 2.3, '胶囊与指标应同为选中 Tab（美股）的口径')
  assert.equal(usBoard.badge, undefined, '行业板块不再使用静态「A股时段/美股时段」徽标')
})

test('buildQuoteGlobalPage：行业板块两个 Tab 的指标 id 与投影结果一致（跳动动画 / wx:key 定位）', () => {
  const page = buildQuoteGlobalPage({
    cnIndices: [],
    usIndices: [],
    macro: [],
    sectorTabs: [
      sectorTab('a', 'A股', [sector('BK1134', 'AI算力', 1.5)], { label: '休市', tone: 'rest' }),
      sectorTab('us', '美股', [sector('BK1134', 'AI算力', 2.3)], {
        label: '美股盘中',
        tone: 'active',
      }),
    ],
    sectorActiveTab: 'a',
    statusLabel: '全球市场',
    statusTone: 'active',
  })

  const board = page.sections.find((section) => section.id === 'industry-board')
  assert.ok(board)
  assert.equal(
    board.metrics[0]?.id,
    board.tabs?.[0]?.metrics?.[0]?.id,
    '投影指标与 Tab 数据应同源（切 Tab 时 wx:key / 跳动动画定位到同一张卡片）',
  )
  assert.equal(board.metrics[0]?.id, 'q-BK1134-0')
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

// ---------------------------------------------------------------------------
// 分组级 hideFlatChange 透传（pct 缺失 / 为 0 时隐藏涨跌徽标）
// ---------------------------------------------------------------------------

test('buildQuoteAsiaPage：分组级 hideFlatChange 透传到指标（此前仅 metals 构建器透传）', () => {
  const items: QuoteItem[] = [
    { code: 'USDJPY', name: '美元/日元', price: 150.2, pct: null },
    { code: 'CNYJPY', name: '人民币/日元', price: 20.5, pct: 0 },
    { code: 'USDKRW', name: '美元/韩元', price: 1380.5, pct: 1.2 },
  ]

  const gated = buildQuoteAsiaPage({
    indexGroups: [{ id: 'asia-fx', title: '汇率', items, hideFlatChange: true }],
    stockGroups: [],
    rates: [],
    statusTone: 'active',
  })
  const gatedSection = gated.sections.find((section) => section.id === 'asia-fx')
  assert.ok(gatedSection)
  assert.equal(gatedSection.metrics[0]?.hideChange, true, 'pct 为 null 时应隐藏涨跌徽标')
  assert.equal(gatedSection.metrics[1]?.hideChange, true, 'pct 为 0 时应隐藏涨跌徽标')
  assert.equal(gatedSection.metrics[2]?.hideChange, false, '有真实涨跌幅时照常展示徽标')

  // 未声明 hideFlatChange 的分组：行为不变（pct 缺失仍按 change=0 渲染）
  const plain = buildQuoteAsiaPage({
    indexGroups: [{ id: 'asia-jp-index', title: '日本指数', items }],
    stockGroups: [],
    rates: [],
    statusTone: 'active',
  })
  const plainSection = plain.sections.find((section) => section.id === 'asia-jp-index')
  assert.ok(plainSection)
  assert.equal(plainSection.metrics[0]?.hideChange, false)
  assert.equal(plainSection.metrics[0]?.change, 0)
})
