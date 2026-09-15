/**
 * 外部行情数据 → 页面展示模型（MarketPageData）的构建器。
 *
 * 三个行情页共用 section-card 渲染，这里把外部接口返回的报价列表
 * 组装成 MarketMetric 结构（name / value=价格 / change=涨跌幅）。
 */

import type { MarketMetric, MarketPageData, MarketSection } from '../types/market'
import { QUOTE_ICON_ASSETS } from '../config/icon-assets'
import { formatDateTime, formatNumber } from './formatter'
import {
  getRegionStatus,
  industryPhaseShort,
  type IndustryPhase,
  type MarketRegion,
} from './market-clock'

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
   * 分时取数专用代码：随会话切换取数口径（如 外盘 GOLD → GOLD-US 取现货 XAUUSD 分时）。
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
  /**
   * 入口卡跳转目标列表页时预选的初始 tab（如 首页板块区入口 → industry-all 页，
   * 由 metricOf 透传到 MarketMetric，页面跳转时按此携带 URL 参数）。
   */
  initialTab?: string
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
  BK1626: '🧪', // 稀土（原 BK1016 漂移，2026-09-07 改现行代码）
  // 2026-09-07 扩充主流行业（09-08 收敛保留 6 项）
  BK0473: '💹', // 证券
  BK1600: '🧬', // 医药外包(CXO)
  BK1326: '⚙️', // 半导体设备
  BK1037: '📱', // 消费电子
  BK1262: '🚘', // 汽车
  BK1301: '🎮', // 游戏
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
    initialTab: item.initialTab,
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
  /**
   * 行业板块双 Tab 数据（A股板块 / 美股板块，见 QuoteGlobalSectorTab）：面板标题固定为
   * 「行业板块」，两个 Tab 的数据**同时**备好（数据层并行取数），用户点 Tab 即时切换、
   * 无需重新请求；面板字段（metrics / 阶段胶囊 / 分时角标）恒为选中 Tab 的投影结果。
   */
  sectorTabs?: QuoteGlobalSectorTab[]
  /**
   * 进入页面默认选中的行业板块 Tab 键，按时段规则判定（utils/market-clock.ts
   * resolveIndustrySource：A股时段 → 'a'；美股盘前/盘中/盘后及夜间周末 → 'us'）。
   * 缺省取第一个 Tab；用户手动切换由页面层覆盖（stores/market.store.ts pickSectionTab）。
   */
  sectorActiveTab?: string
  statusLabel: string
  statusTone: 'active' | 'rest'
}

/**
 * 行业板块面板的单个 Tab（一个市场一份数据）：Tab 键 / 标签 + 该市场的板块条目 +
 * 盘面阶段胶囊（与该市场数据源口径一致，见 utils/market-clock.ts resolveIndustryPhase）+
 * 是否展示「分时」角标（美股盘前只有参考涨跌幅、无分时图 → false）。
 */
export interface QuoteGlobalSectorTab {
  /** Tab 键：'a'（A股板块）/ 'us'（美股板块） */
  key: string
  /** Tab 标签：A股 / 美股 */
  label: string
  /** 该市场的板块条目（无价格，仅涨跌幅；末尾含「全部板块」入口卡） */
  items: QuoteItem[]
  /** 该市场盘面阶段（A股 → 大A盘中/午间休市/休市；美股 → 美股盘前/盘中/盘后/休市） */
  phase: IndustryPhase
  /** 该 Tab 是否以面板右上角单个「分时」角标提示分时可用 */
  minuteCorner: boolean
}

/**
 * 行业板块面板的「i」说明文案（两个 Tab 共用）：先说数据来源，再给出默认选中规则，
 * 让用户理解「为什么现在停在某个市场」以及可以手动切到另一个市场。
 */
function industryBoardTip(): string {
  return [
    '📊 板块数据按市场分 Tab 展示，默认选中与当前时段一致的市场，也可手动切换：',
    '· A股：东方财富 A 股行业板块涨跌幅（A股交易日 09:15 集合竞价起更新，收盘后为当日收盘涨跌幅）；',
    '· 美股：美股代表成分股当日涨跌幅等权均值（美股盘前时段为盘前参考涨跌幅，暂不支持分时图）。',
    '',
    '🕐 默认选中：工作日 09:15 至美股盘前开始前（夏令时 21:30 / 冬令时 22:30）默认「A股」；其余时段（美股盘前/盘中/盘后、夜间、周末）默认「美股」。',
    '',
    '💡 数据来源于公开市场信息，仅供参考，不构成投资建议。',
  ].join('\n')
}

export function buildQuoteGlobalPage(
  params: QuoteGlobalPageParams,
  now: Date = new Date(),
): MarketPageData {
  const sectorTabs = params.sectorTabs ?? []
  // 默认选中 Tab 由数据层按时段规则给出（sectorActiveTab），取不到时回退第一个 Tab
  const activeSectorTab =
    sectorTabs.find((tab) => tab.key === params.sectorActiveTab) ?? sectorTabs[0]
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
  if (activeSectorTab && activeSectorTab.items.length) {
    // 面板标题固定为「行业板块」：不再随会话改标题（此前 A股时段叫「中国行业板块」、
    // 美股时段叫「美股行业板块」），展示的是哪个市场改由面板内 Tab 表达，
    // 当前市场阶段由 phase 胶囊（大A盘中 / 美股盘中 / 休市 …）表达。
    groups.push({ id: 'industry-board', title: '行业板块', items: activeSectorTab.items })
  }

  const sections: MarketSection[] = []
  let offset = 0
  for (const group of groups) {
    // hideFlatChange 必须按分组透传（与 metals 构建器一致）：分组声明了该字段却被丢弃时，
    // pct === null 的条目会按 metricOf 的 `change: item.pct ?? 0` 渲染出无意义的「0.00%」
    const section = sectionOf(group, offset, 'global', {
      hideFlatChange: group.hideFlatChange,
      now,
    })
    if (group.id === 'industry-board' && activeSectorTab) {
      // 行业板块无价格，只有涨跌幅：单行展示
      section.singleLine = true
      // 面板字段 = 选中 Tab 的投影：分时角标（美股盘前无分时图 → 不展示）与阶段化胶囊
      // （大A盘中 / 午间休市 / 休市 / 美股盘前 / 美股盘中 / 美股盘后等）都随 Tab 切换
      section.minuteCorner = activeSectorTab.minuteCorner
      section.marketStatus = activeSectorTab.phase.label
      section.marketTone = activeSectorTab.phase.tone
      section.tip = industryBoardTip()
      section.activeTab = activeSectorTab.key
      // 双 Tab 数据（A股 / 美股）：每个 Tab 携带该市场的条目与展示元信息，页面按当前选中
      // Tab 重新投影上面的字段（用户手动切换，见 utils/market-page-factory.ts sections）。
      // 每个 Tab 还带**自己的**盘面状态（含短文案）：Tab 上直接展示该市场此刻在盘中/休市，
      // 两个市场的状态一眼可比（渲染层不再需要标题右侧的单个状态胶囊，见 components/section-card）。
      // 指标 id 与投影结果同源（offset + index），保证 wx:key / 跳动动画定位到同一张卡片
      section.tabs = sectorTabs.map((tab) => ({
        key: tab.key,
        label: tab.label,
        metrics: tab.items.map((item, index) =>
          metricOf(item, offset + index, { hideFlatChange: group.hideFlatChange }),
        ),
        marketStatus: tab.phase.label,
        marketStatusShort: industryPhaseShort(tab.phase),
        marketTone: tab.phase.tone,
        minuteCorner: tab.minuteCorner,
      }))
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
    // 同全球页：分组级 hideFlatChange 需透传，否则 pct === null 的条目会渲染出无意义的「0.00%」
    sections.push(sectionOf(group, offset, 'asia', { hideFlatChange: group.hideFlatChange, now }))
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
