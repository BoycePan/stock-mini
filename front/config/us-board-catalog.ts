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

/** 美股概念板块（主题/概念口径，43 项） */
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
  c('usc-memory', '存储芯片', ['105.MU', '105.WDC', '105.STX', '105.NTAP']),
  c('usc-data-center', '数据中心', ['106.DLR', '105.EQIX', '106.IRM', '106.VRT']),
  c('usc-cloud', '云计算', [
    '106.VRT',
    '106.VST',
    '105.SMCI',
    '106.CRM',
    '106.NOW',
    '106.SNOW',
    '106.ORCL',
  ]),
  c('usc-ai-software', 'AI软件', [
    '105.MSFT',
    '105.ADBE',
    '106.CRM',
    '106.SNOW',
    '105.PLTR',
    '105.GOOGL',
  ]),
  c('usc-cyber-security', '网络安全', [
    '105.PANW',
    '105.CRWD',
    '105.FTNT',
    '105.ZS',
    '105.OKTA',
    '106.NET',
  ]),
  c('usc-space', '商业航天', ['105.RKLB', '105.ASTS', '106.RDW', '105.LUNR']),
  c('usc-satellite', '卫星通信', ['105.IRDM', '105.GSAT', '105.ASTS', '105.VSAT']),
  c('usc-robot', '机器人', ['107.ROBO', '105.ISRG', '105.TER', '106.PATH', '105.SYM']),
  c('usc-autonomous', '自动驾驶', ['105.DRIV', '105.TSLA', '105.RIVN', '105.MBLY']),
  c('usc-glp1', '减肥药(GLP-1)', ['106.LLY', '106.NVO', '105.VKTX', '105.AMGN', '105.SNY']),
  c('usc-biotech', '生物科技', [
    '105.AMGN',
    '105.MRNA',
    '105.REGN',
    '105.VRTX',
    '105.GILD',
    '105.BIIB',
  ]),
  c('usc-crypto', '加密货币', ['105.COIN', '105.MSTR', '105.MARA', '105.RIOT', '105.HOOD']),
  c('usc-quantum', '量子计算', ['106.IBM', '106.IONQ', '105.RGTI', '105.QUBT', '105.QBTS']),
  c('usc-nuclear', '核电', ['106.OKLO', '106.SMR', '106.CCJ', '105.CEG', '106.LEU', '105.NNE']),
  c('usc-power-grid', '电力设备', [
    '105.CEG',
    '106.VST',
    '106.GEV',
    '106.NEE',
    '106.PWR',
    '106.ETN',
  ]),
  c('usc-defense', '军工', [
    '106.LMT',
    '106.RTX',
    '106.NOC',
    '106.GD',
    '106.LHX',
    '106.HII',
    '106.TXT',
  ]),
  c('usc-solar', '光伏', ['107.TAN', '105.FSLR', '105.ENPH', '105.RUN', '105.ARRY']),
  c('usc-battery', '锂电池·储能', [
    '107.BATT',
    '106.ALB',
    '105.ENPH',
    '105.SEDG',
    '105.QS',
    '105.EOSE',
  ]),
  c('usc-rare-earth', '稀土', ['106.MP', '107.REMX', '107.UUUU']),
  c('usc-china-internet', '中概互联', ['106.BABA', '105.PDD', '105.JD', '105.BIDU', '105.NTES']),
  c('usc-ecommerce', '电商', ['105.AMZN', '106.BABA', '105.PDD', '105.SHOP', '105.EBAY']),
  c('usc-streaming', '流媒体', ['105.NFLX', '106.DIS', '105.WBD', '106.SPOT', '105.ROKU']),
  c('usc-social', '社交媒体', ['105.META', '106.SNAP', '106.PINS', '106.RDDT']),
  c('usc-gaming', '游戏', ['105.NTES', '105.TTWO', '106.U', '106.RBLX']),
  c('usc-genai', '生成式AI', [
    '105.MSFT',
    '105.GOOGL',
    '105.META',
    '106.ORCL',
    '106.CRM',
    '105.PLTR',
  ]),
  c('usc-ai-hardware', 'AI服务器', ['105.SMCI', '106.DELL', '106.HPE', '106.IBM', '105.NTNX']),
  c('usc-foundry', '晶圆代工', ['106.TSM', '105.GFS', '106.UMC', '105.INTC']),
  c('usc-network', '网络设备', ['105.CSCO', '106.ANET', '105.FFIV', '106.NOK', '105.ERIC']),
  c('usc-fintech', '金融科技', ['106.XYZ', '105.SOFI', '105.AFRM', '105.UPST', '105.HOOD']),
  c('usc-vaccine', '疫苗', ['105.MRNA', '105.BNTX', '105.NVAX', '106.PFE', '105.SNY']),
  c('usc-gene-editing', '基因编辑', ['105.CRSP', '105.EDIT', '105.NTLA', '105.BEAM', '105.VRTX']),
  c('usc-hydrogen', '氢能源', ['105.PLUG', '106.BE', '105.FCEL', '105.EOSE']),
  c('usc-ev', '新能源汽车', ['105.TSLA', '105.RIVN', '106.NIO', '105.LI', '106.XPEV', '105.LCID']),
  c('usc-agri', '农业与化肥', ['106.ADM', '106.CTVA', '106.MOS', '106.NTR', '106.CF']),
  c('usc-beauty', '美妆个护', ['106.EL', '106.CL', '105.KMB', '106.UL', '106.PG']),
  c('usc-sportswear', '运动鞋服', ['106.NKE', '105.LULU', '106.DECK', '106.ONON']),
  c('usc-metaverse', '元宇宙', ['105.META', '106.RBLX', '106.U', '105.MSFT', '105.NVDA']),
  c('usc-digital-ads', '数字广告', ['105.TTD', '105.META', '105.GOOGL', '106.RDDT', '106.PINS']),
  c('usc-health-it', '数字医疗', ['106.TDOC', '106.VEEV', '105.OMCL', '106.HIMS', '105.ISRG']),
  c('usc-bigdata', '大数据与云原生', ['105.MDB', '105.DDOG', '106.SNOW', '105.CRWD', '106.NET']),
]

/** 美股行业板块（行业口径，40 项） */
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
    '105.GOOGL',
  ]),
  i('usi-banks', '银行', ['106.JPM', '106.BAC', '106.WFC', '106.GS', '106.MS']),
  i('usi-insurance', '保险', ['106.MET', '106.PRU', '106.AIG', '106.ALL', '106.CB', '106.TRV']),
  i('usi-payments', '支付金融', ['106.V', '106.MA', '106.AXP', '105.PYPL', '106.GPN', '106.XYZ']),
  i('usi-medical-devices', '医疗器械', ['106.MDT', '106.ABT', '106.SYK', '106.BSX', '105.ISRG']),
  i('usi-biopharma', '生物医药', ['106.LLY', '106.PFE', '106.MRK', '106.ABBV', '105.AMGN']),
  i('usi-health-services', '医疗保健服务', [
    '106.UNH',
    '106.CVS',
    '106.HUM',
    '106.CI',
    '106.ELV',
    '106.MCK',
  ]),
  i('usi-oil-gas', '石油能源', [
    '106.XOM',
    '106.CVX',
    '106.COP',
    '107.XLE',
    '106.EOG',
    '106.OXY',
    '106.SLB',
  ]),
  i('usi-natural-gas', '天然气', ['107.FCG', '106.EQT', '106.AR', '106.RRC', '106.LNG']),
  i('usi-mining', '金属矿业', ['106.FCX', '106.SCCO', '106.TECK', '106.AA', '106.VALE']),
  i('usi-gold', '黄金', ['107.GDX', '106.NEM', '106.AEM', '106.KGC', '106.AU']),
  i('usi-staples', '必需消费', ['106.KO', '106.PG', '105.PEP', '105.WMT', '105.COST', '105.MDLZ']),
  i('usi-retail', '零售', ['105.AMZN', '106.HD', '106.LOW', '106.TGT', '106.TJX', '105.ROST']),
  i('usi-restaurants', '餐饮连锁', [
    '106.MCD',
    '106.YUM',
    '106.CMG',
    '105.SBUX',
    '106.DRI',
    '106.QSR',
    '105.TXRH',
  ]),
  i('usi-autos', '汽车', ['105.TSLA', '106.GM', '106.F', '105.RIVN', '106.HMC', '106.TM']),
  i('usi-airlines', '航空', ['106.DAL', '106.LUV', '105.UAL', '105.AAL', '106.ALK', '106.CPA']),
  i('usi-telecom', '通信运营商', ['106.T', '106.VZ', '105.TMUS', '105.CMCSA', '105.CHTR']),
  i('usi-utilities', '公用事业', ['106.DUK', '106.SO', '106.NEE', '105.AEP', '105.EXC', '106.ED']),
  i('usi-industrials', '工业制造', ['106.CAT', '106.DE', '106.EMR', '105.HON', '106.BA']),
  i('usi-chemicals', '化工材料', ['105.LIN', '106.DOW', '106.SHW', '106.APD', '106.DD', '106.PPG']),
  i('usi-realty', '房地产REIT', [
    '106.PLD',
    '106.AMT',
    '106.SPG',
    '106.O',
    '106.WELL',
    '106.VICI',
    '106.PSA',
  ]),
  i('usi-asset-mgmt', '资产管理', [
    '106.BLK',
    '106.BX',
    '106.KKR',
    '106.ARES',
    '106.APO',
    '105.TROW',
  ]),
  i('usi-exchange', '交易所与金融数据', [
    '105.CME',
    '106.ICE',
    '105.NDAQ',
    '106.MCO',
    '106.SPGI',
    '107.CBOE',
  ]),
  i('usi-ins-broker', '保险经纪', ['106.AON', '106.AJG', '106.BRO', '105.WTW']),
  i('usi-pharma-dist', '医药流通', ['106.MCK', '106.CAH', '106.COR', '106.CVS']),
  i('usi-life-sci', '生命科学工具', [
    '106.TMO',
    '106.DHR',
    '106.WAT',
    '105.ILMN',
    '105.IDXX',
    '106.A',
  ]),
  i('usi-hospitality', '酒店旅游', ['105.MAR', '106.HLT', '105.BKNG', '105.ABNB', '105.EXPE']),
  i('usi-railway', '铁路运输', ['106.UNP', '105.CSX', '106.NSC', '106.CNI']),
  i('usi-logistics', '物流快递', ['106.UPS', '106.FDX', '106.XPO', '105.ODFL', '105.CHRW']),
  i('usi-autoparts', '汽车零部件', [
    '106.APTV',
    '106.MGA',
    '106.ALV',
    '106.BWA',
    '106.LEA',
    '106.DAN',
  ]),
  i('usi-homebuilder', '住宅建筑', ['106.DHI', '106.LEN', '106.PHM', '106.NVR', '106.TOL']),
  i('usi-steel', '钢铁', ['106.NUE', '105.STLD', '106.CLF', '106.RS']),
  i('usi-buildmat', '建材', ['106.MLM', '106.VMC', '106.CRH', '106.JHX', '106.EXP']),
  i('usi-aero', '航空航天', ['106.BA', '106.GE', '106.HWM', '106.TDG', '106.HEI', '106.LHX']),
  i('usi-regional-bank', '区域银行', ['106.PNC', '106.USB', '106.FITB', '106.KEY']),
  i('usi-enviro', '环保水务', ['106.WM', '106.RSG', '106.XYL', '106.AWK', '106.WTRG', '106.VLTO']),
  i('usi-industrial-dist', '工业分销', ['105.FAST', '106.GPC', '106.MSM', '106.WCC', '105.POOL']),
  i('usi-electrical', '电气设备', [
    '106.ETN',
    '106.ROK',
    '106.AME',
    '106.EMR',
    '106.GEV',
    '105.SYM',
  ]),
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
