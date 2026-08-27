/**
 * 首页卡片 → 当日分时图数据源映射（纯前端，直连外部接口，见 docs/minute-api.md）。
 *
 * 与首页行情同源（①腾讯 / ②新浪 / ③东财 + Yahoo 补充），分时侧对应：
 *   - em    东方财富分时  push2delay.eastmoney.com/api/qt/stock/trends2/get（ndays=1 当日分钟线，覆盖最广）
 *   - tc    腾讯分时     web.ifzq.gtimg.cn/appstock/app/minute/query（A股/港股兜底）
 *   - yahoo Yahoo 1分钟   query1.finance.yahoo.com/v8/finance/chart?range=1d&interval=1m
 *                        （东财/腾讯分时均不覆盖且无大陆可直连源的标的刻意不配置：
 *                          KOSDAQ（仅 Yahoo ^KQ11）、TOPIX（无东证指数本身分时）、
 *                          恐慌指数 VIX（仅 Yahoo ^VIX），卡片不显示「分时」入口；
 *                          韩股/日股/USDKRW/USDJPY 已改由东财 177/176/119 覆盖；
 *                          汇率 CNYKRW/CNYJPY/USDCNY 已改由东财 119/133 或交叉合成覆盖；
 *                          Yahoo 仅作大陆外兜底，大陆访问被墙）
 *   - emProxies 美股代理股分时均值合成（东财 trends2，每只代理归一化到昨收 100 后取均值，
 *     用于美股时段行业板块：卡片展示的正是代理股涨跌幅均值，合成图与之同口径）
 *
 * 取数优先级：em → tc → yahoo（与首页「新浪 → 腾讯 → 东财」兜底链同思路）。
 * 每个 secid / 代码均已实测可拿到当日分时数据（验证矩阵见 docs/minute-api.md「验证结果」）。
 *
 * 会话随卡片口径切换（见 api/market.ts）：
 *   - 有色页 GOLD/SILVER/COPPER 在「外盘」时段卡片展示 COMEX 报价，分时对应
 *     GOLD-US / SILVER-US / COPPER-US（东财 COMEX 分时，与全球页 GC/SI/HG 同一已验证源）；
 *   - 美股时段行业板块（us-BKxxxx）为代理股分时均值合成，标注各代理股中文名；
 *   - 外盘无分时源的金属（us-ALUMINUM 等）**刻意不配置**：卡片展示外盘报价但没有
 *     已验证的外盘分时源，点击给出提示而非展示错误市场（沪主连/A股）的数据。
 */

import { INDUSTRY_BOARDS } from './tabbar'

export interface MinuteSources {
  /** 东财分时 secid（trends2/get，如 1.000001 / 113.aum / 90.BK1134） */
  em?: string
  /** 腾讯分时行情代码（如 sh000001 / sh600549，A股/港股） */
  tc?: string
  /** Yahoo 1分钟 符号（如 ^VIX / 005930.KS / CNYKRW=X） */
  yahoo?: string
  /**
   * 美股代理股分时均值合成：东财 secid 数组（如 ['105.NVDA', '105.AMD']）。
   * 每只代理归一化到昨收 100 后逐分钟取均值（跨零点对齐），与卡片展示的代理股涨跌幅均值同口径。
   */
  emProxies?: string[]
  /**
   * 交叉汇率合成：numerator / denominator 逐分钟相除（东财 trends2，完整时间戳对齐）。
   * 用于东财无直盘分时的货币对（如 人民币/韩元 = 美元/韩元 ÷ 美元/离岸人民币），
   * 两腿均为大陆可访问的东财 24h 连续分时，合成序列无成交量/均价口径。
   */
  emCross?: { numerator: string; denominator: string }
  /** 展示提示（如 TOPIX 用 ETF 代理时说明图表标的），有值时在分时页面板标题下展示 */
  note?: string
}

/**
 * 美股代理股中文名表（key 为裸代码，105.NVDA → NVDA）。
 * 覆盖 INDUSTRY_BOARDS 全部代理股（测试强制校验，新增代理漏配会失败）；
 * 名称优先采用东财返回的中文名（实测 105.NVDA=英伟达 / 105.AMD=超威半导体 等），
 * 东财返回英文名的代理股（Coherent/Lumentum/Vertiv 等）在此补中文名；
 * ETF 统一用简短中文名（半导体ETF / 机器人ETF 等），便于分时页标注阅读。
 * 展示时以此表为准，东财名仅作未收录时的兜底。
 */
export const US_PROXY_NAMES: Record<string, string> = {
  // AI算力
  NVDA: '英伟达',
  AMD: '超威半导体',
  AVGO: '博通',
  MRVL: '迈威尔科技',
  SMCI: '超微电脑',
  // CPO
  COHR: '高意', // Coherent
  LITE: '朗美通', // Lumentum
  AAOI: '应用光电',
  FN: '飞尼科', // Fabrinet
  CIEN: 'Ciena科技',
  // 半导体 / 存储
  SOXX: '半导体ETF',
  MU: '美光科技',
  WDC: '西部数据',
  STX: '希捷科技',
  // 数据中心 / 云计算
  DLR: '数字房地产信托',
  EQIX: '易昆尼克斯',
  VRT: '维谛技术', // Vertiv
  VST: '维斯特拉', // Vistra
  CRM: '赛富时',
  NOW: '现在服务公司', // ServiceNow
  SNOW: '雪花数据', // Snowflake
  ORCL: '甲骨文',
  // 商业航天 / 卫星
  RKLB: '火箭实验室', // Rocket Lab
  ASTS: 'AST太空移动', // AST SpaceMobile
  RDW: '红线航天', // Redwire
  LUNR: '直觉机器', // Intuitive Machines
  IRDM: '铱星通讯',
  GSAT: '全球星',
  VSAT: '卫讯公司',
  // 机器人 / 自动驾驶 / 核电 / 电网
  ROBO: '机器人ETF',
  DRIV: '自动驾驶ETF', // Global X Autonomous & Electric Vehicles ETF
  OKLO: '奥克洛', // Oklo
  SMR: '纽斯凯尔', // NuScale Power
  CEG: '星座能源', // Constellation Energy
  GEV: 'GE维诺瓦', // GE Vernova
  NEE: '新纪元能源',
  PWR: '广达服务',
  ETN: '伊顿',
  // 军工 / 新能源 / 光伏 / 锂电池 / 能源
  LMT: '洛克希德马丁',
  RTX: '雷神技术',
  NOC: '诺斯罗普-格鲁曼',
  GD: '通用动力',
  ENPH: '恩福能源', // Enphase Energy
  FSLR: '第一太阳能',
  RIVN: '里维安', // Rivian
  SEDG: '太阳能边际', // SolarEdge Technologies
  TAN: '光伏ETF',
  BATT: '锂电池ETF', // Amplify Battery Metals & Materials ETF
  XLE: '能源ETF',
  FCG: '天然气ETF',
  // 铜/有色 / 黄金 / 银行金融 / 生物医药 / 消费 / 稀土
  FCX: '自由港麦克莫兰',
  SCCO: '南方铜业',
  TECK: '泰克资源',
  AA: '美国铝业',
  GDX: '黄金矿业ETF',
  JPM: '摩根大通',
  BAC: '美国银行',
  WFC: '富国银行',
  GS: '高盛',
  LLY: '礼来',
  PFE: '辉瑞',
  MRK: '默沙东',
  ABBV: '艾伯维',
  KO: '可口可乐',
  PG: '宝洁',
  WMT: '沃尔玛',
  COST: '开市客',
  MP: 'MP材料', // MP Materials
  REMX: '稀土ETF',
  UUUU: '能源燃料', // Energy Fuels
}

/**
 * 首页行情卡片 code → 当日分时数据源。
 * 无条目的卡片（如金店金价 GS-*、财经新闻）不支持分时图。
 * 韩股/日股（东财 177/176）、USDKRW/USDJPY（东财 119）、USDCNY/CNYJPY（东财 133 离岸）、
 * CNYKRW（东财交叉合成）已由东财分时覆盖，Yahoo 1分钟保留兜底。
 * 恐慌指数 VIX / KOSDAQ / TOPIX **刻意不配置**：VIX 与 KOSDAQ 仅 Yahoo 有分时（^VIX / ^KQ11）
 * 且大陆被墙、TOPIX 无东证指数本身分时（原 ETF 代理不可用），均无大陆可直连源。
 * 因此这些卡片不显示「分时」角标、点击提示暂无数据，避免大陆用户点进分时页后加载失败
 * （见 utils/market-page-factory.ts onMetricTap）。
 */
export const MINUTE_SOURCES: Record<string, MinuteSources> = {
  // -------------------------------------------------------------------------
  // 全球页 · A股指数 / 美股指数
  // -------------------------------------------------------------------------
  sh000001: { em: '1.000001', tc: 'sh000001' }, // 上证指数
  sz399001: { em: '0.399001', tc: 'sz399001' }, // 深证成指
  sz399006: { em: '0.399006', tc: 'sz399006' }, // 创业板指
  sh000688: { em: '1.000688', tc: 'sh000688' }, // 科创50
  // A股平均股价：东财官方平均股价指数（市场号 47），与卡片报价同 secid，见 api/market.ts
  AVG: { em: '47.800005' },
  usDJI: { em: '100.DJIA' }, // 道琼斯工业（东财指数）
  usINX: { em: '100.SPX' }, // 标普500（S&P 500 指数，东财分时；与卡片 usINX 同口径）
  usIXIC: { em: '100.NDX' }, // 纳斯达克（Nasdaq Composite 指数，东财 secid 用 NDX；与卡片 usIXIC 同口径）

  // -------------------------------------------------------------------------
  // 全球页 · 宏观经济
  // -------------------------------------------------------------------------
  BRT: { em: '112.B00Y' }, // 布伦特原油
  // 恐慌指数 VIX：刻意不配置分时源（仅 Yahoo ^VIX 有分时但大陆被墙），
  // 卡片不显示「分时」角标，点击给出「该指标暂无分时数据」提示。
  UDI: { em: '100.UDI' }, // 美元指数（24h 行情，点较多）
  TLT: { em: '105.TLT' }, // 美债长债
  GC: { em: '101.GC00Y' }, // 黄金盎司（COMEX）
  SI: { em: '101.SI00Y' }, // 白银盎司（COMEX）
  HG: { em: '101.HG00Y' }, // 铜（COMEX）
  NG: { em: '102.NG00Y' }, // 天然气（NYMEX）
  SOX: { em: '251.SOX' }, // 费城半导体指数

  // -------------------------------------------------------------------------
  // 全球页 · 行业板块（东财板块指数 90.BKxxxx）
  // -------------------------------------------------------------------------
  BK1134: { em: '90.BK1134' },
  BK1128: { em: '90.BK1128' },
  BK0917: { em: '90.BK0917' },
  BK1137: { em: '90.BK1137' },
  BK0922: { em: '90.BK0922' },
  BK0579: { em: '90.BK0579' },
  BK0963: { em: '90.BK0963' },
  BK0921: { em: '90.BK0921' },
  BK1090: { em: '90.BK1090' },
  BK0802: { em: '90.BK0802' },
  BK0577: { em: '90.BK0577' },
  BK1647: { em: '90.BK1647' },
  BK0490: { em: '90.BK0490' },
  BK0493: { em: '90.BK0493' },
  BK0588: { em: '90.BK0588' },
  BK0574: { em: '90.BK0574' },
  BK0464: { em: '90.BK0464' },
  BK0843: { em: '90.BK0843' },
  BK0478: { em: '90.BK0478' },
  BK0547: { em: '90.BK0547' },
  BK0475: { em: '90.BK0475' },
  BK1216: { em: '90.BK1216' },
  BK0438: { em: '90.BK0438' },
  BK1016: { em: '90.BK1016' },

  // -------------------------------------------------------------------------
  // 日韩页 · 指数
  // -------------------------------------------------------------------------
  KS11: { em: '100.KS11' }, // KOSPI
  // KOSDAQ / TOPIX **刻意不配置**分时源：
  // - KOSDAQ：东财/腾讯均无分时，仅 Yahoo ^KQ11 有分时且大陆被墙，无大陆可直连源；
  // - TOPIX：东财/腾讯/Yahoo 均无东证指数本身分时，原「日本东证指数ETF(513800)」代理不可用。
  // 两者卡片均不显示「分时」角标、点击提示暂无数据（见 utils/market-page-factory.ts onMetricTap）。
  N225: { em: '100.N225' }, // 日经225
  VNINDEX: { em: '100.VNINDEX' }, // 越南胡志明
  SENSEX: { em: '100.SENSEX' }, // 孟买SENSEX

  // -------------------------------------------------------------------------
  // 日韩页 · 个股（韩股市场号 177、日股 176：东财 trends2 已实测覆盖，
  // 首选东财分时，Yahoo 1分钟保留作大陆外/兜底备用）
  // -------------------------------------------------------------------------
  '005930': { em: '177.005930', yahoo: '005930.KS' }, // 三星电子
  '000660': { em: '177.000660', yahoo: '000660.KS' }, // SK海力士
  '373220': { em: '177.373220', yahoo: '373220.KS' }, // LG新能源
  '066570': { em: '177.066570', yahoo: '066570.KS' }, // LG电子
  '035420': { em: '177.035420', yahoo: '035420.KS' }, // NAVER
  '005380': { em: '177.005380', yahoo: '005380.KS' }, // 现代汽车
  '068270': { em: '177.068270', yahoo: '068270.KS' }, // 赛尔群
  '051910': { em: '177.051910', yahoo: '051910.KS' }, // LG化学
  '8035': { em: '176.8035', yahoo: '8035.T' }, // 东京电子
  '6954': { em: '176.6954', yahoo: '6954.T' }, // 发那科
  '6861': { em: '176.6861', yahoo: '6861.T' }, // 基恩士
  '7203': { em: '176.7203', yahoo: '7203.T' }, // 丰田汽车
  '6758': { em: '176.6758', yahoo: '6758.T' }, // 索尼
  '4063': { em: '176.4063', yahoo: '4063.T' }, // 信越化学
  '6981': { em: '176.6981', yahoo: '6981.T' }, // 村田制作所
  '7974': { em: '176.7974', yahoo: '7974.T' }, // 任天堂

  // -------------------------------------------------------------------------
  // 日韩页 · 汇率（东财系为主源，大陆可访问；Yahoo 仅作大陆外兜底）
  // - USDKRW/USDJPY：东财 119 直盘（119.USDKRW / 119.USDJPY，实测覆盖）；
  // - USDCNY：卡片已同步改为离岸（东财 133.USDCNH，见 config/tabbar.ts MACRO_ASSETS），
  //   分时同源无价差；CNYJPY 卡片仍为在岸口径，改用离岸 133.CNHJPY（实测覆盖，note 提示价差）；
  // - CNYKRW：东财无直盘，按 美元/韩元 ÷ 美元/离岸人民币 交叉合成（口径见 note）。
  // -------------------------------------------------------------------------
  CNYKRW: {
    emCross: { numerator: '119.USDKRW', denominator: '133.USDCNH' },
    yahoo: 'CNYKRW=X',
    note: '人民币/韩元无直盘分时，此图按「美元/韩元 ÷ 美元/离岸人民币」合成（离岸口径）',
  },
  CNYJPY: {
    em: '133.CNHJPY',
    yahoo: 'CNYJPY=X',
    note: '分时取自离岸人民币兑日元（CNHJPY），与卡片在岸口径略有价差',
  },
  USDKRW: { em: '119.USDKRW', yahoo: 'KRW=X' }, // 美元/韩元
  USDJPY: { em: '119.USDJPY', yahoo: 'JPY=X' }, // 美元/日元
  USDCNY: { em: '133.USDCNH', yahoo: 'CNY=X' }, // 美元/离岸人民币（卡片与分时同源东财 133.USDCNH）

  // -------------------------------------------------------------------------
  // 有色页 · 金银/工业金属（沪 主连 = 东财 SHFE 连续合约；含夜盘，点较多）
  // -------------------------------------------------------------------------
  GOLD: { em: '113.aum' }, // 黄金 → 沪金主连（元/克）
  SILVER: { em: '113.agm' }, // 白银 → 沪银主连（元/千克）
  COPPER: { em: '113.cum' }, // 铜 → 沪铜主连（元/吨）
  ALUMINUM: { em: '113.alm' }, // 铝 → 沪铝主连
  ZINC: { em: '113.znm' }, // 锌 → 沪锌主连
  NICKEL: { em: '113.nim' }, // 镍 → 沪镍主连
  TIN: { em: '113.snm' }, // 锡 → 沪锡主连

  // -------------------------------------------------------------------------
  // 有色页 · 外盘时段（卡片展示 COMEX 报价时的分时对应，与全球页 GC/SI/HG 同一已验证源）
  // -------------------------------------------------------------------------
  'GOLD-US': {
    em: '101.GC00Y',
    note: '外盘时段：分时为 COMEX 黄金（美元/盎司），与卡片口径一致',
  },
  'SILVER-US': {
    em: '101.SI00Y',
    note: '外盘时段：分时为 COMEX 白银（美元/盎司），与卡片口径一致',
  },
  'COPPER-US': {
    em: '101.HG00Y',
    note: '外盘时段：分时为 COMEX 铜（美元/磅），与卡片口径一致',
  },

  // 其他金属：无现货/期货分时，取对应 A 股上市公司（与首页 tc 兜底同标的）
  TUNGSTEN: { em: '1.600549', tc: 'sh600549' }, // 钨 → 厦门钨业
  MOLY: { em: '1.603993', tc: 'sh603993' }, // 钼 → 洛阳钼业
  GERMANIUM: { em: '0.002428', tc: 'sz002428' }, // 锗 → 云南锗业
  INDIUM: { em: '1.600961', tc: 'sh600961' }, // 铟 → 株冶集团
  ANTIMONY: { em: '1.601020', tc: 'sh601020' }, // 锑 → 华钰矿业

  // -------------------------------------------------------------------------
  // 全球页 · 美股时段行业板块（us-BKxxxx，见 utils/market-page-factory onMetricTap 的 minuteCode）
  // 卡片展示的正是美股代理股涨跌幅均值，分时同样取代理股均值合成（东财 trends2，跨零点对齐，
  // 基准=昨收100）。代理列表与 config/tabbar.ts 的 INDUSTRY_BOARDS 单一数据源保持一致。
  // -------------------------------------------------------------------------
  ...buildUsBoardMinuteSources(),
}

/**
 * 美股时段行业板块的分时源：us-<板块代码> → 代理股分时均值合成。
 * 由 INDUSTRY_BOARDS 自动生成，保证代理列表与首页行情取数完全一致。
 */
function buildUsBoardMinuteSources(): Record<string, MinuteSources> {
  const entries: Record<string, MinuteSources> = {}
  for (const board of INDUSTRY_BOARDS) {
    entries[`us-${board.code}`] = { emProxies: [...board.proxies] }
  }
  return entries
}

/**
 * 东财美股个股 secid 模式（如 105.NVDA / 106.BRK_B / 107.AAPL）：
 * 供美股TOP100列表等场景直连东财个股分时（trends2）与报价（ulist.np/get），
 * 无需为每只个股在 MINUTE_SOURCES 逐条登记。
 * 仅匹配美股三大市场号：105=纳斯达克 / 106=纽交所 / 107=美交所。
 */
export const EM_US_SECID_RE = /^(105|106|107)\.[A-Z][A-Z0-9._]*$/i

/** 该卡片 code 是否支持当日分时图（有任一可用源；美股个股 secid 走兜底） */
export function hasMinuteSources(code: string): boolean {
  return !!code && !!resolveMinuteSources(code)
}

/**
 * 取某卡片的分时源（无源返回 null）。
 * 美股个股 secid 未在 MINUTE_SOURCES 登记时直接按东财分时兜底（见 EM_US_SECID_RE）。
 */
export function resolveMinuteSources(code: string): MinuteSources | null {
  if (MINUTE_SOURCES[code]) return MINUTE_SOURCES[code]
  if (EM_US_SECID_RE.test(code)) return { em: code }
  return null
}
