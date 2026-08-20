/**
 * TabBar 三个行情页（全球 / 日韩 / 有色）的标的配置（docs/tabbar-api.md 四）。
 *
 * 本文件只承载「接口参数」：行情代码、新浪/东财 key、价格区间、代理股等，会用于构造外部请求。
 * 展示用图标（Emoji）不放在这里，统一维护在 utils/quote-pages.ts 的 QUOTE_ICONS（按 code 映射）。
 * 美股代理股市场号按东财实际归属：105.=纳斯达克（NVDA 等）、106.=纽交所（JPM 等）、107.=美交所（BATT 等 ETF）。
 */

import type { QuoteSource } from '../types/quote'

// ---------------------------------------------------------------------------
// 全球页
// ---------------------------------------------------------------------------

/** 全球指数（腾讯行情代码，与实时会话探测共用一次请求；A股平均股价取数链见 api/market.ts） */
export interface GlobalIndexConfig {
  code: string
  name: string
  /** 市场归属：cn = 中国（A股）指数，us = 美股指数；页面按此拆分为「A股指数」「美股指数」两个分区 */
  market: 'cn' | 'us'
}

export const GLOBAL_INDICES: GlobalIndexConfig[] = [
  { code: 'sh000001', name: '上证指数', market: 'cn' },
  { code: 'sz399001', name: '深证成指', market: 'cn' },
  { code: 'sz399006', name: '创业板指', market: 'cn' },
  { code: 'sh000688', name: '科创50', market: 'cn' },
  { code: 'usDJI', name: '道琼斯工业', market: 'us' },
  { code: 'usSPY', name: '标普500', market: 'us' },
  { code: 'usQQQ', name: '纳斯达克', market: 'us' },
]

/**
 * A股平均股价（通达信 880003 口径，全市场等权平均）。
 * 取数链（见 api/market.ts）：①东财官方平均股价指数（ulist.np/get，secid `emSecid`，
 * 用户指定接口）→ ②腾讯 sh880003（与全球指数同批请求）→ ③新浪 sh880003 →
 * ④东财全市场等权自算（60s 缓存）。前四路任一路给出有效价格即采用。
 */
export const AVG_PRICE_CONFIG = {
  code: 'AVG',
  name: 'A股平均股价',
  /** 东财官方平均股价指数 secid（市场号 47 = 平均股价指数） */
  emSecid: '47.800005',
  tc: 'sh880003',
  sinaKey: 'sh880003',
} as const

/** 宏观资产 10 项（docs 表 A：code / name / 数据源） */
export interface MacroAssetConfig {
  code: string
  name: string
  sources: QuoteSource[]
}

export const MACRO_ASSETS: MacroAssetConfig[] = [
  {
    code: 'VIX',
    name: '恐慌指数',
    sources: [
      { kind: 'sina_znb', key: 'znb_VIX', min: 5, max: 200 },
      { kind: 'tencent', key: 'usVIX', min: 5, max: 200 },
      { kind: 'em', secid: '100.VIX', min: 5, max: 200 },
    ],
  },
  {
    code: 'SOX',
    name: '费城半导体指数',
    // 东财 secid 251.SOX（市场号 251，非 100/105）：腾讯 usSOX 无效、新浪 gb_/znb_ 字段布局
    // 与解析器不兼容（会产生 previousClose=涨跌幅、changePercent=时间戳的错值），仅东财可靠。
    sources: [{ kind: 'em', secid: '251.SOX', min: 300, max: 60000 }],
  },

  {
    code: 'BRT',
    name: '布伦特原油',
    sources: [{ kind: 'sina_hf', key: 'hf_OIL', min: 20, max: 400 }],
  },
  {
    code: 'UDI',
    name: '美元强弱',
    sources: [
      { kind: 'sina_diniw', key: 'DINIW', min: 60, max: 200 },
      { kind: 'em', secid: '100.UDI', min: 60, max: 200 },
    ],
  },
  {
    code: 'USDCNY',
    name: '美元/人民币',
    // 人民币汇率仅新浪 fx_ 可用（腾讯无外汇代码、东财 119 无 USDCNY 标的，见 docs 表 A）
    sources: [{ kind: 'sina_fx', key: 'fx_susdcny', min: 5, max: 10 }],
  },
  {
    code: 'TLT',
    name: '美债长债',
    sources: [
      { kind: 'sina_gb', key: 'gb_TLT', min: 50, max: 300 },
      { kind: 'tencent', key: 'usTLT', min: 50, max: 300 },
      { kind: 'em', secid: ['105.TLT', '106.TLT', '107.TLT'], min: 50, max: 300 },
    ],
  },
  {
    code: 'GC',
    name: '黄金盎司',
    sources: [{ kind: 'sina_hf', key: ['hf_GC', 'hf_XAU'], min: 1200, max: 6000 }],
  },
  {
    code: 'SI',
    name: '白银盎司',
    sources: [{ kind: 'sina_hf', key: ['hf_SI', 'hf_XAG'], min: 8, max: 120 }],
  },
  {
    code: 'HG',
    name: '铜',
    sources: [{ kind: 'sina_hf', key: 'hf_HG', min: 50, max: 2000 }],
  },
  {
    code: 'NG',
    name: '天然气',
    sources: [{ kind: 'sina_hf', key: 'hf_NG', min: 0.5, max: 50 }],
  },
]

/** 行业板块 24 项（docs 表 B：aSecid 固定 90.BKxxxx，proxies 为美股代理股） */
export interface IndustryBoardConfig {
  code: string
  name: string
  proxies: string[]
}

export const INDUSTRY_BOARDS: IndustryBoardConfig[] = [
  {
    code: 'BK1134',
    name: 'AI算力',
    proxies: ['105.NVDA', '105.AMD', '105.AVGO', '105.MRVL', '105.SMCI'],
  },
  {
    code: 'BK1128',
    name: 'CPO',
    proxies: ['106.COHR', '105.LITE', '105.AAOI', '106.FN', '106.CIEN'],
  },
  { code: 'BK0917', name: '半导体', proxies: ['105.SOXX'] },
  { code: 'BK1137', name: '存储', proxies: ['105.MU', '105.WDC', '105.STX'] },
  { code: 'BK0922', name: '数据中心', proxies: ['106.DLR', '105.EQIX'] },
  {
    code: 'BK0579',
    name: '云计算',
    proxies: ['106.VRT', '106.VST', '105.SMCI', '106.CRM', '106.NOW', '106.SNOW', '106.ORCL'],
  },
  { code: 'BK0963', name: '商业航天', proxies: ['105.RKLB', '105.ASTS', '106.RDW', '105.LUNR'] },
  { code: 'BK0921', name: '卫星', proxies: ['105.ASTS', '105.IRDM', '105.GSAT', '105.VSAT'] },
  { code: 'BK1090', name: '机器人', proxies: ['107.ROBO'] },
  { code: 'BK0802', name: '自动驾驶', proxies: ['105.DRIV'] },
  { code: 'BK0577', name: '核电', proxies: ['106.OKLO', '106.SMR'] },
  {
    code: 'BK1647',
    name: '电网',
    proxies: ['105.CEG', '106.VST', '106.GEV', '106.NEE', '106.PWR', '106.ETN'],
  },
  { code: 'BK0490', name: '军工', proxies: ['106.LMT', '106.RTX', '106.NOC', '106.GD'] },
  { code: 'BK0493', name: '新能源', proxies: ['105.ENPH', '105.FSLR', '105.RIVN', '105.SEDG'] },
  { code: 'BK0588', name: '光伏', proxies: ['107.TAN'] },
  { code: 'BK0574', name: '锂电池', proxies: ['107.BATT'] },
  { code: 'BK0464', name: '石油', proxies: ['107.XLE'] },
  { code: 'BK0843', name: '天然气', proxies: ['107.FCG'] },
  { code: 'BK0478', name: '铜/有色', proxies: ['106.FCX', '106.SCCO', '106.TECK', '106.AA'] },
  { code: 'BK0547', name: '黄金', proxies: ['107.GDX'] },
  { code: 'BK0475', name: '银行金融', proxies: ['106.JPM', '106.BAC', '106.WFC', '106.GS'] },
  { code: 'BK1216', name: '生物医药', proxies: ['106.LLY', '106.PFE', '106.MRK', '106.ABBV'] },
  { code: 'BK0438', name: '消费', proxies: ['106.KO', '106.PG', '105.WMT', '105.COST'] },
  { code: 'BK1016', name: '稀土', proxies: ['106.MP', '107.REMX', '107.UUUU'] },
]

// ---------------------------------------------------------------------------
// 日韩页
// ---------------------------------------------------------------------------

export interface AsiaIndexConfig {
  code: string
  name: string
  sinaKey: string
  /** 新浪解析失败时的东财兜底 secid */
  emSecid?: string
  /** 价格合理区间校验（docs「解析与数据校验」） */
  min: number
  max: number
  /**
   * 是否东财优先取数（需同时配置 emSecid）：用于新浪源陈旧 / 已不更新的指数
   * （如 int_nikkei 响应只剩 4 个字段、数值长期停留在旧点位，但能通过区间校验，
   * 旧的「新浪优先、东财仅失败兜底」会一直展示旧值）。东财 secid 与分时页同源
   * （100.N225 / 100.VNINDEX），优先东财可保证「卡片展示值」与「点进去的分时」口径一致；
   * 东财失败时仍退回新浪。
   */
  preferEm?: boolean
}

export const ASIA_INDICES: AsiaIndexConfig[] = [
  { code: 'KS11', name: 'KOSPI', sinaKey: 'znb_KOSPI', emSecid: '100.KS11', min: 1500, max: 9000 },
  { code: 'KQ11', name: 'KOSDAQ', sinaKey: 'znb_KOSDAQ', min: 400, max: 2500 },
  {
    code: 'N225',
    name: '日经225',
    sinaKey: 'int_nikkei',
    emSecid: '100.N225',
    // 区间仅作垃圾数据护栏：日经已长期运行在 6 万点上方（2026 年约 6.6 万），
    // 旧上限 55000 会把东财真实新值（65982）当异常丢弃、回退到新浪陈旧旧值（44946）。
    min: 15000,
    max: 100000,
    preferEm: true,
  },
  { code: 'TPX', name: 'TOPIX', sinaKey: 'znb_TOPIX', min: 1500, max: 6000 },
  {
    code: 'VNINDEX',
    name: '越南胡志明',
    sinaKey: 'znb_VNINDEX',
    emSecid: '100.VNINDEX',
    min: 500,
    max: 3000,
    preferEm: true,
  },
  { code: 'SENSEX', name: '孟买SENSEX', sinaKey: 'znb_SENSEX', min: 30000, max: 120000 },
]

export interface AsiaStockConfig {
  code: string
  /** 中文公司名（页面固定展示，忽略外部源返回的英文名，如 Samsung Electronics） */
  name: string
  /** 腾讯行情代码 */
  tc: string
  /** 东财 secid 兜底 */
  emSecid: string
}

export const ASIA_KR_STOCKS: AsiaStockConfig[] = [
  { code: '005930', name: '三星电子', tc: 'kr005930', emSecid: '177.005930' }, // 存储
  { code: '000660', name: 'SK海力士', tc: 'kr000660', emSecid: '177.000660' }, // 半导体
  { code: '373220', name: 'LG新能源', tc: 'kr373220', emSecid: '177.373220' }, // 电池
  { code: '066570', name: 'LG电子', tc: 'kr066570', emSecid: '177.066570' }, // 消费电子
  { code: '035420', name: 'NAVER', tc: 'kr035420', emSecid: '177.035420' }, // 互联网
  { code: '005380', name: '现代汽车', tc: 'kr005380', emSecid: '177.005380' }, // 汽车
  { code: '068270', name: '赛尔群', tc: 'kr068270', emSecid: '177.068270' }, // 生物医药
  { code: '051910', name: 'LG化学', tc: 'kr051910', emSecid: '177.051910' }, // 化工材料
]

export const ASIA_JP_STOCKS: AsiaStockConfig[] = [
  { code: '8035', name: '东京电子', tc: 'jp8035', emSecid: '176.8035' }, // 半导体设备
  { code: '6954', name: '发那科', tc: 'jp6954', emSecid: '176.6954' }, // 工业自动化
  { code: '6861', name: '基恩士', tc: 'jp6861', emSecid: '176.6861' }, // 精密制造
  { code: '7203', name: '丰田汽车', tc: 'jp7203', emSecid: '176.7203' }, // 汽车产业链
  { code: '6758', name: '索尼', tc: 'jp6758', emSecid: '176.6758' }, // 消费电子
  { code: '4063', name: '信越化学', tc: 'jp4063', emSecid: '176.4063' }, // 半导体材料
  { code: '6981', name: '村田制作所', tc: 'jp6981', emSecid: '176.6981' }, // 电子元件
  { code: '7974', name: '任天堂', tc: 'jp7974', emSecid: '176.7974' }, // 游戏娱乐
]

export interface AsiaRateConfig {
  code: string
  name: string
  sinaKey: string
  emSecid: string
}

export const ASIA_RATES: AsiaRateConfig[] = [
  { code: 'CNYKRW', name: '人民币/韩元', sinaKey: 'fx_scnykrw', emSecid: '119.CNYKRW' },
  { code: 'CNYJPY', name: '人民币/日元', sinaKey: 'fx_scnyjpy', emSecid: '119.CNYJPY' },
  { code: 'USDKRW', name: '美元/韩元', sinaKey: 'fx_susdkrw', emSecid: '119.USDKRW' },
  { code: 'USDJPY', name: '美元/日元', sinaKey: 'fx_susdjpy', emSecid: '119.USDJPY' },
  { code: 'USDCNY', name: '美元/人民币', sinaKey: 'fx_susdcny', emSecid: '119.USDCNY' },
]

// ---------------------------------------------------------------------------
// 有色页
// ---------------------------------------------------------------------------

export interface MetalConfig {
  code: string
  name: string
  /** 国内（A股）新浪 key */
  aKeys: string[]
  /** 外盘新浪 key */
  usKeys: string[]
  /** 国内价格区间校验（aExtra） */
  aRange?: [number, number]
  /** 外盘价格区间校验（usExtra） */
  usRange?: [number, number]
  /** 腾讯兜底行情代码（tc 类金属股 / 钨 sh600549） */
  tc?: string
}

export const METALS: MetalConfig[] = [
  {
    code: 'GOLD',
    name: '黄金',
    aKeys: ['nf_AU0', 'nf_AU'],
    usKeys: ['hf_GC', 'hf_XAU'],
    aRange: [200, 1200],
    usRange: [1200, 6000],
  },
  {
    code: 'SILVER',
    name: '白银',
    aKeys: ['nf_AG0', 'nf_AG'],
    usKeys: ['hf_SI', 'hf_XAG'],
    aRange: [2000, 20000],
    usRange: [8, 120],
  },
  {
    code: 'COPPER',
    name: '铜',
    aKeys: ['nf_CU0', 'nf_CU'],
    usKeys: ['hf_HG'],
    aRange: [30000, 120000],
    usRange: [50, 2000],
  },
  { code: 'ALUMINUM', name: '铝', aKeys: ['nf_AL0', 'nf_AL'], usKeys: ['hf_AHD'] },
  { code: 'ZINC', name: '锌', aKeys: ['nf_ZN0', 'nf_ZN'], usKeys: ['hf_ZSD'] },
  { code: 'NICKEL', name: '镍', aKeys: ['nf_NI0', 'nf_NI'], usKeys: ['hf_NID'] },
  { code: 'TIN', name: '锡', aKeys: ['nf_SN0', 'nf_SN'], usKeys: ['hf_SND'] },
  { code: 'TUNGSTEN', name: '钨', aKeys: [], usKeys: ['hf_W'], tc: 'sh600549' },
  { code: 'MOLY', name: '钼', aKeys: [], usKeys: [], tc: 'sh603993' },
  { code: 'GERMANIUM', name: '锗', aKeys: [], usKeys: [], tc: 'sz002428' },
  { code: 'INDIUM', name: '铟', aKeys: [], usKeys: [], tc: 'sh600961' },
  { code: 'ANTIMONY', name: '锑', aKeys: [], usKeys: [], tc: 'sh601020' },
]

export interface MetalSectionConfig {
  id: string
  title: string
  codes: string[]
  /** 标题右侧「i」说明文案 */
  tip?: string
}

export const METAL_SECTIONS: MetalSectionConfig[] = [
  { id: 'precious', title: '金银', codes: ['GOLD', 'SILVER'] },
  { id: 'industrial', title: '工业金属', codes: ['COPPER', 'ALUMINUM', 'ZINC', 'NICKEL', 'TIN'] },
  {
    id: 'other',
    title: '其他金属',
    codes: ['TUNGSTEN', 'MOLY', 'GERMANIUM', 'INDIUM', 'ANTIMONY'],
    tip: '钼/锗/铟/锑暂无统一现货报价，展示的是对应 A 股上市公司（个股）的股价',
  },
]

/** 有色页新浪批量 key（内/外盘切换 useA 只影响解析顺序，批量一次拉全） */
export function metalSinaKeys(): string[] {
  return Array.from(new Set(METALS.flatMap((metal) => [...metal.aKeys, ...metal.usKeys])))
}
