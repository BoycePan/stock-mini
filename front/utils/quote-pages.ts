/**
 * 外部行情数据 → 页面展示模型（MarketPageData）的构建器。
 *
 * 三个行情页共用 section-card 渲染，这里把外部接口返回的报价列表
 * 组装成 MarketMetric 结构（name / value=价格 / change=涨跌幅）。
 */

import type { MarketMetric, MarketPageData, MarketSection } from '../types/market'
import { formatDateTime, formatNumber } from './formatter'
import { getRegionStatus, type MarketRegion } from './market-clock'

/** 页面行情条目（外部数据归一化后的展示单元） */
export interface QuoteItem {
  code: string
  name: string
  price: number | null
  /** 涨跌幅（%） */
  pct: number | null
  unit?: string
  icon?: string
  /** 指标名称旁的小徽标（如「个股」、代表金属「钼」），按序随指标展示 */
  tags?: string[]
  /** 条目更新时间文案（如「09:53 更新」），有值时才在卡片上展示 */
  updatedAt?: string
  /**
   * 分时取数专用代码：随会话切换取数口径（如 外盘 GOLD → GOLD-US 取 COMEX 分时）。
   * 缺省时用 code 取分时；该 code 无分时源时卡片不显示「分时」入口。
   */
  minuteCode?: string
  /** 无分时源时点击卡片的提示文案（覆盖默认「该指标暂无分时数据」） */
  minuteUnavailableTip?: string
}

export interface QuoteGroup {
  id: string
  title: string
  items: QuoteItem[]
  /** 标题右侧「i」说明文案，透传到 MarketSection.tip */
  tip?: string
  /** 涨跌幅缺失或为 0 时隐藏涨跌徽标（如金店金价上游不保证提供涨跌幅） */
  hideFlatChange?: boolean
  /** 市场区域：有值时板块标题右侧展示盘面状态（盘中/休市等，见 utils/market-clock.ts） */
  region?: MarketRegion
}

/**
 * 展示用图标（Emoji），按行情 code 映射，仅供 section-card 渲染，不参与任何接口请求。
 * 与 config/tabbar.ts（接口参数）分离维护。
 */
export const QUOTE_ICONS: Record<string, string> = {
  // 全球指数（中国指数 / 美股指数）
  sh000001: '🇨🇳',
  sz399001: '🇨🇳',
  sz399006: '🇨🇳', // 创业板指
  sh000688: '🇨🇳', // 科创50
  AVG: '🧮', // A股平均股价（全市场等权自算）
  usDJI: '🇺🇸', // 道琼斯工业
  usINX: '🇺🇸',
  usIXIC: '🇺🇸',
  // 宏观经济
  BRT: '🛢️',
  VIX: '📉',
  UDI: '💵',
  TLT: '📊',
  GC: '🥇',
  SI: '🥈',
  HG: '⚙️',
  NG: '🔥',
  SOX: '🔬', // 费城半导体指数
  // 行业板块
  BK1134: '🧠', // AI算力
  BK1128: '💡', // CPO
  BK0917: '🔬', // 半导体
  BK1137: '💾', // 存储
  BK0922: '🗄️', // 数据中心
  BK0579: '☁️', // 云计算
  BK0963: '🚀', // 商业航天
  BK0921: '🛰️', // 卫星
  BK1090: '🤖', // 机器人
  BK0802: '🚗', // 自动驾驶
  BK0577: '☢️', // 核电
  BK1647: '⚡', // 电网
  BK0490: '🛡️', // 军工
  BK0493: '🌱', // 新能源
  BK0588: '☀️', // 光伏
  BK0574: '🔋', // 锂电池
  BK0464: '🛢️', // 石油
  BK0843: '⛽', // 天然气
  BK0478: '🧲', // 铜/有色
  BK0547: '🥇', // 黄金
  BK0475: '🏦', // 银行金融
  BK1216: '💊', // 生物医药
  BK0438: '🛒', // 消费
  BK1016: '🧪', // 稀土
  // 日韩指数
  KS11: '🇰🇷',
  KQ11: '🇰🇷',
  N225: '🇯🇵',
  TPX: '🇯🇵',
  VNINDEX: '🇻🇳',
  SENSEX: '🇮🇳',
  // 日韩个股
  '005930': '💾',
  '000660': '🔬',
  '373220': '🔋',
  '066570': '📱',
  '035420': '🌐',
  '005380': '🚗',
  '068270': '💊',
  '051910': '🧪',
  '8035': '🔬',
  '6954': '🏭',
  '6861': '🔧',
  '7203': '🚗',
  '6758': '📱',
  '4063': '💠',
  '6981': '🔌',
  '7974': '🎮',
  // 汇率
  CNYKRW: '💱',
  CNYJPY: '💱',
  USDKRW: '💱',
  USDJPY: '💱',
  USDCNY: '💱',
  // 有色金属
  GOLD: '🥇',
  SILVER: '🥈',
  COPPER: '🔧',
  ALUMINUM: '🪙',
  ZINC: '⚙️',
  NICKEL: '🛠️',
  TIN: '🧰',
  TUNGSTEN: '🔩',
  MOLY: '⚒️',
  GERMANIUM: '💎',
  INDIUM: '📀',
  ANTIMONY: '🧪',
}

function metricOf(
  item: QuoteItem,
  index: number,
  opts?: { hideFlatChange?: boolean },
): MarketMetric {
  return {
    id: `q-${item.code}-${index}`,
    code: item.code,
    minuteCode: item.minuteCode,
    minuteUnavailableTip: item.minuteUnavailableTip,
    name: item.name,
    value: item.price === null ? '' : formatNumber(item.price),
    change: item.pct ?? 0,
    // 汇率等场景：涨跌幅缺失或恰好为 0 时隐藏涨跌徽标，避免展示无意义的 "— —"
    hideChange: opts?.hideFlatChange === true && (item.pct === null || item.pct === 0),
    unit: item.unit,
    icon: item.icon ?? QUOTE_ICONS[item.code],
    tags: item.tags,
    updatedAt: item.updatedAt,
  }
}

function sectionOf(
  group: QuoteGroup,
  offset: number,
  tone: MarketSection['tone'],
  opts?: { hideFlatChange?: boolean; now?: Date },
): MarketSection {
  const section: MarketSection = {
    id: group.id,
    title: group.title,
    tone,
    tip: group.tip,
    metrics: group.items.map((item, index) => metricOf(item, offset + index, opts)),
  }
  // 板块右侧盘面状态：按市场区域实时时钟 + 节假日日历判定
  if (group.region) {
    const status = getRegionStatus(group.region, opts?.now)
    section.marketStatus = status.label
    section.marketTone = status.tone
  }
  return section
}

// ---------------------------------------------------------------------------
// 全球页：中国指数 + 美股指数 + 宏观经济 + 行业板块
// ---------------------------------------------------------------------------

export interface QuoteGlobalPageParams {
  /** 中国指数（A股四大指数 + A股平均股价） */
  cnIndices: QuoteItem[]
  /** 美股指数（道琼斯 / 标普500 / 纳斯达克） */
  usIndices: QuoteItem[]
  macro: QuoteItem[]
  sectors: QuoteItem[]
  statusLabel: string
  statusTone: 'active' | 'rest'
  /** 板块数据源会话徽标（如 A股时段 / 美股时段） */
  sectorBadge?: string
  /** 板块标题：随数据源会话切换（A股时段 → 中国行业板块；美股时段 → 美股行业板块） */
  sectorTitle?: string
  /**
   * 行业板块当前数据源对应市场区域（A股时段 → 'cn'；美股时段 → 'us'）：
   * 有值时板块标题右侧展示盘面状态（盘中/午休/盘前/盘后/休市，见 utils/market-clock.ts），
   * 与数据源口径一致（展示的是哪个市场的行情，就标哪个市场的开闭状态）。
   */
  sectorRegion?: MarketRegion
}

export function buildQuoteGlobalPage(
  params: QuoteGlobalPageParams,
  now: Date = new Date(),
): MarketPageData {
  const groups: QuoteGroup[] = []
  if (params.cnIndices.length) {
    groups.push({ id: 'cn-index', title: 'A股指数', items: params.cnIndices, region: 'cn' })
  }
  if (params.usIndices.length) {
    groups.push({ id: 'us-index', title: '美股指数', items: params.usIndices, region: 'us' })
  }
  if (params.macro.length) {
    groups.push({ id: 'global-economy', title: '宏观经济', items: params.macro })
  }
  if (params.sectors.length) {
    // 板块本体为东方财富 A 股行业板块（BK 代码）；A股时段展示东财板块数据，标题为「中国行业板块」；
    // 非 A 股时段展示美股代理股涨跌幅均值，标题随之切换为「美股行业板块」。
    // sectorRegion 与数据源会话一致（useA → 'cn'，否则 'us'），标题右侧展示对应市场的盘面状态。
    groups.push({
      id: 'industry-board',
      title: params.sectorTitle ?? '中国行业板块',
      items: params.sectors,
      region: params.sectorRegion,
    })
  }

  const sections: MarketSection[] = []
  let offset = 0
  for (const group of groups) {
    const section = sectionOf(group, offset, 'global', { now })
    if (group.id === 'industry-board') {
      // 行业板块无价格，只有涨跌幅：单行展示
      section.singleLine = true
      // 板块分时随会话切换：A股时段 → 东财板块分时；美股时段 → 美股代理股均值合成分时。
      // 两个会话均有分时图，整面板右上角以单个「分时」角标提示
      section.minuteCorner = true
      if (params.sectorBadge) {
        section.badge = params.sectorBadge
      }
      section.tip = [
        '板块数据随交易时段自动切换：',
        '· 中国行业板块（A股时段）：北京时间 周一至周五 09:30–15:00（含午休）；',
        '· 美股行业板块（其余时段）：周一至周五 15:00–次日 09:30 及周末，取美股代理股涨跌幅均值。',
        '',
        '全球产业数据根据公开产业信息整理，仅供信息参考。',
      ].join('\n')
    }
    sections.push(section)
    offset += group.items.length
  }

  return {
    statusLabel: params.statusLabel,
    statusTone: params.statusTone,
    updatedLabel: `数据更新时间：${formatDateTime()}`,
    sections,
  }
}

// ---------------------------------------------------------------------------
// 日韩页：指数组 + 个股组 + 汇率
// ---------------------------------------------------------------------------

export interface QuoteAsiaPageParams {
  indexGroups: QuoteGroup[]
  stockGroups: QuoteGroup[]
  rates: QuoteItem[]
  statusTone: 'active' | 'rest'
}

export function buildQuoteAsiaPage(
  params: QuoteAsiaPageParams,
  now: Date = new Date(),
): MarketPageData {
  const sections: MarketSection[] = []
  let offset = 0
  for (const group of [...params.indexGroups, ...params.stockGroups]) {
    sections.push(sectionOf(group, offset, 'asia', { now }))
    offset += group.items.length
  }
  if (params.rates.length) {
    sections.push(
      sectionOf({ id: 'asia-fx', title: '汇率', items: params.rates }, offset, 'asia', {
        hideFlatChange: true,
        now,
      }),
    )
  }

  return {
    statusLabel: '亚太',
    statusTone: params.statusTone,
    updatedLabel: `数据更新时间：${formatDateTime()}`,
    sections,
  }
}

// ---------------------------------------------------------------------------
// 有色页：金银 / 工业金属 / 其他金属
// ---------------------------------------------------------------------------

export interface QuoteMetalsPageParams {
  groups: QuoteGroup[]
  statusTone: 'active' | 'rest'
  /** 内外盘徽标（如 国内盘 / 外盘） */
  badge?: string
}

export function buildQuoteMetalsPage(params: QuoteMetalsPageParams): MarketPageData {
  const sections: MarketSection[] = []
  let offset = 0
  for (const group of params.groups) {
    const section = sectionOf(group, offset, 'metals', {
      hideFlatChange: group.hideFlatChange,
    })
    if (params.badge && offset === 0) {
      section.badge = params.badge
    }
    sections.push(section)
    offset += group.items.length
  }

  return {
    statusLabel: '有色',
    statusTone: params.statusTone,
    updatedLabel: `数据更新时间：${formatDateTime()}`,
    sections,
  }
}

/** 一组条目是否含有有效报价（用于 statusTone 判定） */
export function hasLiveQuote(items: QuoteItem[]): boolean {
  return items.some((item) => item.price !== null)
}
