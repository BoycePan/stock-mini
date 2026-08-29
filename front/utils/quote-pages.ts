/**
 * 外部行情数据 → 页面展示模型（MarketPageData）的构建器。
 *
 * 三个行情页共用 section-card 渲染，这里把外部接口返回的报价列表
 * 组装成 MarketMetric 结构（name / value=价格 / change=涨跌幅）。
 */

import type { MarketMetric, MarketPageData, MarketSection } from '../types/market'
import { QUOTE_ICON_ASSETS } from '../config/icon-assets'
import { formatDateTime, formatNumber } from './formatter'
import { getRegionStatus, type IndustryPhase, type MarketRegion } from './market-clock'

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
  /**
   * 指标名称旁图标图片路径（本地静态图）。有值时优先于 icon（Emoji）渲染；
   * 金店品牌 logo 等在此显式指定。
   */
  iconImage?: string
  /** 条目更新时间文案（如「09:53 更新」），有值时才在卡片上展示 */
  updatedAt?: string
  /**
   * 分时取数专用代码：随会话切换取数口径（如 外盘 GOLD → GOLD-US 取 COMEX 分时）。
   * 缺省时用 code 取分时；该 code 无分时源时卡片不显示「分时」入口。
   */
  minuteCode?: string
  /** 无分时源时点击卡片的提示文案（覆盖默认「该指标暂无分时数据」） */
  minuteUnavailableTip?: string
  /**
   * 展示值文本：覆盖默认「价格」渲染（如入口卡「查看」）。
   * 有值时即使 price 为 null 也不显示骨架占位。
   */
  valueText?: string
  /** 始终隐藏涨跌徽标（入口卡等无行情涨跌语义的条目） */
  hideChange?: boolean
  /** 不出现在分享海报中（如「市值TOP100」入口卡，海报里无行情语义） */
  hideFromPoster?: boolean
  /** 特殊入口卡：以整行渐变横幅渲染（区别于普通行情卡片，见 section-card） */
  featured?: boolean
  /** 特殊入口卡的副标题（如「美股三大市场 · 市值前100个股」） */
  featuredDesc?: string
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
  'us-top100': '🇺🇸', // 美股TOP100 入口卡
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
    value: item.valueText ?? (item.price === null ? '' : formatNumber(item.price)),
    change: item.pct ?? 0,
    // 汇率等场景：涨跌幅缺失或恰好为 0 时隐藏涨跌徽标，避免展示无意义的 "— —"；
    // 入口卡等条目显式 hideChange 时始终隐藏
    hideChange:
      item.hideChange === true ||
      (opts?.hideFlatChange === true && (item.pct === null || item.pct === 0)),
    hideFromPoster: item.hideFromPoster === true,
    featured: item.featured === true,
    featuredDesc: item.featuredDesc,
    unit: item.unit,
    icon: item.icon ?? QUOTE_ICONS[item.code],
    iconImage: item.iconImage ?? QUOTE_ICON_ASSETS[item.code],
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
  /**
   * 行业板块盘面阶段（大A盘中 / 午间休市 / 休市 / 美股盘前 / 美股盘中 / 美股盘后，
   * 见 utils/market-clock.ts resolveIndustryPhase）：有值时板块标题右侧展示阶段化胶囊
   * （复用 marketStatus / marketTone 渲染），与数据源口径一致——展示的是哪个市场的数据，
   * 就标哪个市场的阶段（A股板块 → A股阶段；美股盘前 → 盘前；美股代理 → 美股阶段）。
   */
  sectorPhase?: IndustryPhase
  /** 板块标题：随数据源会话切换（A股时段 → 中国行业板块；美股时段 → 美股行业板块） */
  sectorTitle?: string
  /**
   * 行业板块「分时」角标：美股盘前仅支持参考涨跌幅、无分时图（false），
   * A 股时段 / 美股时段默认 true（东财板块分时 / 代理股合成分时）。
   */
  sectorMinuteCorner?: boolean
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
    // 标题右侧的阶段化胶囊由 sectorPhase 提供（与数据源会话一致），见 utils/market-clock.ts。
    groups.push({
      id: 'industry-board',
      title: params.sectorTitle ?? '中国行业板块',
      items: params.sectors,
    })
  }

  const sections: MarketSection[] = []
  let offset = 0
  for (const group of groups) {
    const section = sectionOf(group, offset, 'global', { now })
    if (group.id === 'industry-board') {
      // 行业板块无价格，只有涨跌幅：单行展示
      section.singleLine = true
      // 板块分时随会话切换：A股时段 → 东财板块分时；美股时段 → 美股代理股均值合成分时；
      // 美股盘前仅支持参考涨跌幅、无分时图（sectorMinuteCorner=false，无「分时」角标）。
      // 两个有分时的会话以面板右上角单个「分时」角标提示
      section.minuteCorner = params.sectorMinuteCorner !== false
      if (params.sectorPhase) {
        // 阶段化胶囊（大A盘中 / 午间休市 / 休市 / 美股盘前 / 美股盘中 / 美股盘后等）
        section.marketStatus = params.sectorPhase.label
        section.marketTone = params.sectorPhase.tone
      }
      section.tipTitle = 'A股/美股行业板块'

      section.tip = [
        '📊 板块数据根据当前市场时段自动切换：',
        '· A股时段及收盘后（工作日 09:15 至 下午美股盘前开始）：显示中国行业板块涨跌情况；',
        '· 美股盘前（夏令时 16:00–21:30 / 冬令时 17:00–22:30）：显示美股行业板块盘前参考涨跌幅，暂不支持分时图；',
        '· 美股盘中/盘后（约 21:30 至次日 08:00/09:00）及周末夜间：显示美股行业板块涨跌情况（休市时段为上一交易日数据）。',
        '',
        '💡 数据来源于公开市场信息，仅供参考，不构成投资建议。',
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
