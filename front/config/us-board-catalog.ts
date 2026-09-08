/**
 * 美股概念 / 行业板块（精选目录）配置 —— industry-all 页「美股概念」「美股行业」两个 Tab 的数据源。
 *
 * 背景：国内公开行情源（东财 / 新浪 / 腾讯）**没有**「美股板块全量目录 + 板块级涨跌幅 + 成分股」
 * 这类 A 股 m:90 板块行情接口（东财 clist 对 m:105/106/107 只返回个股；实测美股个股仅带 f127
 * 一个粗粒度 GICS 行业字符串，如 AAPL/NVDA 均为「信息技术」）。因此美股板块采用本仓库首页
 * 「美股行业板块」同款口径：**精选主题目录 + 美股代表成分股**，板块涨跌幅 = 成分股当日涨跌幅
 * 等权均值（数据源：新浪 hq.sinajs.cn gb_ 优先、东财 ulist 兜底；美股盘前时段展示新浪 gb_
 * 盘前参考涨跌幅，见 utils/quote.ts / utils/market-clock.ts resolveIndustrySource）。
 *
 * 成分股 secid 的市场号（105=纳斯达克 / 106=纽交所 / 107=美交所及部分 ETF）与东财中文名
 * 已逐只经东财 suggest(type=14) / ulist 实测核实（2026-09，全量命中）：
 * 例如 105.AAPL=苹果、105.NVDA=英伟达、106.LLY=礼来、107.SOXX 的同类 ETF 走 105.SOXX 等。
 * 新增 / 增删成分时，需先经东财 suggest(type=14) 核实市场号，勿凭直觉写 105/106。
 */

/** 美股板块大类：concept = 概念 / industry = 行业（与 A 股板块目录互为独立分类） */
export type UsBoardKind = 'concept' | 'industry'

/** 单个美股板块配置（名称 + 板块代码 + 美股成分股 secid 列表） */
export interface UsBoard {
  /** 板块代码（内部稳定标识，列表展示时不下发；跨分类唯一） */
  code: string
  /** 板块中文名（列表展示名，如「AI算力」「银行」） */
  name: string
  /** 成分股东财 secid（105./106./107. 前缀 + 代码），板块涨跌幅 = 命中成分涨跌幅等权均值 */
  proxies: string[]
}

const c = (code: string, name: string, proxies: string[]): UsBoard => ({ code, name, proxies })
const i = c

/** 美股概念板块（主题/概念口径，27 项） */
export const US_CONCEPT_BOARDS: UsBoard[] = [
  c('usc-ai-compute', 'AI算力', ['105.NVDA', '105.AMD', '105.AVGO', '105.MRVL', '105.SMCI']),
  c('usc-cpo', '光模块·CPO', ['106.COHR', '105.LITE', '105.AAOI', '106.FN', '106.CIEN']),
  c('usc-semiconductor', '半导体', [
    '105.SOXX',
    '105.NVDA',
    '105.AMD',
    '105.AVGO',
    '105.TXN',
    '105.QCOM',
  ]),
  c('usc-memory', '存储芯片', ['105.MU', '105.WDC', '105.STX']),
  c('usc-data-center', '数据中心', ['106.DLR', '105.EQIX']),
  c('usc-cloud', '云计算', [
    '106.VRT',
    '106.VST',
    '105.SMCI',
    '106.CRM',
    '106.NOW',
    '106.SNOW',
    '106.ORCL',
  ]),
  c('usc-ai-software', 'AI软件', ['105.MSFT', '105.ADBE', '106.CRM', '106.SNOW', '105.PLTR']),
  c('usc-cyber-security', '网络安全', ['105.PANW', '105.CRWD', '105.FTNT', '105.ZS']),
  c('usc-space', '商业航天', ['105.RKLB', '105.ASTS', '106.RDW', '105.LUNR']),
  c('usc-satellite', '卫星通信', ['105.IRDM', '105.GSAT', '105.ASTS']),
  c('usc-robot', '机器人', ['107.ROBO', '105.ISRG', '105.TER']),
  c('usc-autonomous', '自动驾驶', ['105.DRIV', '105.TSLA', '105.RIVN']),
  c('usc-glp1', '减肥药(GLP-1)', ['106.LLY', '106.NVO', '105.VKTX']),
  c('usc-biotech', '生物科技', ['105.AMGN', '105.MRNA', '105.REGN', '105.VRTX']),
  c('usc-crypto', '加密货币', ['105.COIN', '105.MSTR', '105.MARA', '105.RIOT', '105.HOOD']),
  c('usc-quantum', '量子计算', ['106.IBM', '106.IONQ', '105.RGTI', '105.QUBT']),
  c('usc-nuclear', '核电', ['106.OKLO', '106.SMR', '106.CCJ', '105.CEG']),
  c('usc-power-grid', '电力设备', [
    '105.CEG',
    '106.VST',
    '106.GEV',
    '106.NEE',
    '106.PWR',
    '106.ETN',
  ]),
  c('usc-defense', '军工', ['106.LMT', '106.RTX', '106.NOC', '106.GD']),
  c('usc-solar', '光伏', ['107.TAN', '105.FSLR', '105.ENPH']),
  c('usc-battery', '锂电池·储能', ['107.BATT', '106.ALB', '105.ENPH', '105.SEDG']),
  c('usc-rare-earth', '稀土', ['106.MP', '107.REMX', '107.UUUU']),
  c('usc-china-internet', '中概互联', ['106.BABA', '105.PDD', '105.JD', '105.BIDU', '105.NTES']),
  c('usc-ecommerce', '电商', ['105.AMZN', '106.BABA', '105.PDD', '105.SHOP', '105.EBAY']),
  c('usc-streaming', '流媒体', ['105.NFLX', '106.DIS', '105.WBD', '106.SPOT']),
  c('usc-social', '社交媒体', ['105.META', '106.SNAP', '106.PINS']),
  c('usc-gaming', '游戏', ['105.NTES', '105.TTWO', '106.U']),
]

/** 美股行业板块（行业口径，23 项） */
export const US_INDUSTRY_BOARDS: UsBoard[] = [
  i('usi-semi-equipment', '半导体设备', [
    '105.AMAT',
    '105.LRCX',
    '105.KLAC',
    '105.ASML',
    '105.TER',
  ]),
  i('usi-software', '软件服务', ['105.MSFT', '105.ADBE', '106.ORCL', '106.CRM', '106.NOW']),
  i('usi-consumer-electronics', '消费电子', [
    '105.AAPL',
    '106.DELL',
    '106.HPQ',
    '105.INTC',
    '105.CSCO',
  ]),
  i('usi-banks', '银行', ['106.JPM', '106.BAC', '106.WFC', '106.GS', '106.MS']),
  i('usi-insurance', '保险', ['106.MET', '106.PRU', '106.AIG', '106.ALL']),
  i('usi-payments', '支付金融', ['106.V', '106.MA', '106.AXP', '105.PYPL']),
  i('usi-medical-devices', '医疗器械', ['106.MDT', '106.ABT', '106.SYK', '106.BSX', '105.ISRG']),
  i('usi-biopharma', '生物医药', ['106.LLY', '106.PFE', '106.MRK', '106.ABBV', '105.AMGN']),
  i('usi-health-services', '医疗保健服务', ['106.UNH', '106.CVS', '106.HUM', '106.CI']),
  i('usi-oil-gas', '石油能源', ['106.XOM', '106.CVX', '106.COP', '107.XLE']),
  i('usi-natural-gas', '天然气', ['107.FCG', '106.EQT']),
  i('usi-mining', '金属矿业', ['106.FCX', '106.SCCO', '106.TECK', '106.AA']),
  i('usi-gold', '黄金', ['107.GDX', '106.NEM', '106.AEM']),
  i('usi-staples', '必需消费', ['106.KO', '106.PG', '105.PEP', '105.WMT', '105.COST', '105.MDLZ']),
  i('usi-retail', '零售', ['105.AMZN', '106.HD', '106.LOW', '106.TGT']),
  i('usi-restaurants', '餐饮连锁', ['106.MCD', '106.YUM', '106.CMG', '105.SBUX']),
  i('usi-autos', '汽车', ['105.TSLA', '106.GM', '106.F', '105.RIVN']),
  i('usi-airlines', '航空', ['106.DAL', '106.LUV', '105.UAL', '105.AAL']),
  i('usi-telecom', '通信运营商', ['106.T', '106.VZ', '105.TMUS', '105.CMCSA']),
  i('usi-utilities', '公用事业', ['106.DUK', '106.SO', '106.NEE']),
  i('usi-industrials', '工业制造', ['106.CAT', '106.DE', '106.EMR', '105.HON', '106.BA']),
  i('usi-chemicals', '化工材料', ['105.LIN', '106.DOW', '106.SHW']),
  i('usi-realty', '房地产REIT', ['106.PLD', '106.AMT', '106.SPG', '106.O']),
]

/** 取指定分类的全部美股板块（concept / industry） */
export function usBoardsOf(kind: UsBoardKind): UsBoard[] {
  return kind === 'concept' ? US_CONCEPT_BOARDS : US_INDUSTRY_BOARDS
}

/** 板块代码 → 板块（美股成分弹窗 / 行点击时按 code 还原） */
export function usBoardByCode(code: string): UsBoard | null {
  return (
    US_CONCEPT_BOARDS.find((board) => board.code === code) ??
    US_INDUSTRY_BOARDS.find((board) => board.code === code) ??
    null
  )
}

/** 某分类全部板块的成分股去重 secid 列表（列表页取数一次批量拉全，减少请求数） */
export function usBoardProxiesOf(kind: UsBoardKind): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const board of usBoardsOf(kind)) {
    for (const proxy of board.proxies) {
      if (seen.has(proxy)) continue
      seen.add(proxy)
      result.push(proxy)
    }
  }
  return result
}
