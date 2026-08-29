/**
 * 外部行情接口（docs/tabbar-api.md ①-④）的传输 / 归一化类型。
 *
 * 外部数据源：
 *   ① 腾讯行情 qt.gtimg.cn（纯文本）
 *   ② 新浪行情 hq.sinajs.cn（纯文本）
 *   ③ 东财个股行情 push2delay.eastmoney.com/api/qt/stock/get（JSON）
 *   ④ 东财列表行情 push2delay.eastmoney.com/api/qt/ulist.np/get（JSON）
 */

/** 腾讯行情解析结果（v_<code>="..." 按 ~ 拆分） */
export interface TencentQuote {
  /** 行情代码（如 sh000001 / usIXIC / kr005930） */
  code: string
  /** 名称 [1] */
  name: string
  /** 现价 [3] */
  latestPrice: number | null
  /** 昨收 [4] */
  previousClose: number | null
  /** 今开 [5] */
  open: number | null
  /** 最高 [6] */
  high: number | null
  /** 最低 [7] */
  low: number | null
  /** 成交量 [8] */
  volume: number | null
  /** 成交额 [9] */
  amount: number | null
  /** 涨跌额 [31]（缺失时按 现价-昨收 反推） */
  change: number | null
  /** 涨跌幅（%）[32] */
  changePercent: number | null
  /** 行情时间 [30]（已归一化） */
  quoteTime: string
  /** 字段是否完整（fields.length>=35 且非 pv_none_match） */
  valid: boolean
}

/** 新浪行情原始行（hq_str_<key>="..." 按 , 拆分） */
export interface SinaRow {
  /** 品类 key（hf_ / nf_ / znb_ / gb_ / fx_ / DINIW / int_nikkei …） */
  key: string
  /** 逗号分隔的原始字段（空行 = 无数据） */
  fields: string[]
  /** 原始字符串（"" 表示该 key 无数据） */
  raw: string
}

/** 新浪按品类解析后的统一报价 */
export interface SinaQuote {
  key: string
  price: number | null
  previousClose: number | null
  change: number | null
  changePercent: number | null
}

/** 东财 stock/get 归一化报价 */
export interface EastmoneyQuote {
  secid: string
  code: string
  name: string
  marketName: string
  latestPrice: number | null
  previousClose: number | null
  open: number | null
  high: number | null
  low: number | null
  change: number | null
  changePercent: number | null
  volume: number | null
  amount: number | null
  /** 行情时间戳（毫秒） */
  quoteTimestamp: number | null
  quoteTime: string
  /** 时间戳缺失或距今 >4h 视为 stale */
  isStale: boolean
}

/** 东财 ulist.np/get 报价（分时页「基础信息」取数，fltt=2 十进制，与分时同 secid） */
export interface EastmoneyUlistQuote {
  secid: string
  /** 代码（f12，如 DJIA） */
  code: string
  /** 市场号（f13，如 100） */
  market: string
  /** 名称（f14） */
  name: string
  /** 最新价（f2） */
  price: number | null
  /** 涨跌幅 %（f3） */
  changePercent: number | null
  /** 今开（f17） */
  open: number | null
  /** 最高（f15） */
  high: number | null
  /** 最低（f16） */
  low: number | null
  /** 昨收（f18） */
  previousClose: number | null
  /** 成交量（f5；A股为手、美股为股，页面统一按「手」展示） */
  volume: number | null
  /** 成交额（f6） */
  amount: number | null
}

/** 多源聚合中的单个源报价 */
export interface SourceQuote {
  price: number | null
  previousClose: number | null
  change: number | null
  changePercent: number | null
  name?: string
  /** 来源标识（如 sina_hf / tencent / em） */
  source: string
}

/** fetchAccurate 数据源类型 */
export type QuoteSourceKind =
  | 'sina_hf'
  | 'sina_nf'
  | 'sina_znb'
  | 'sina_diniw'
  | 'sina_gb'
  | 'sina_fx'
  | 'sina_ashare'
  | 'tencent'
  | 'em'
  /**
   * 东财 ulist 报价（ulist.np/get + fltt=2，价格十进制不除 divisor）。
   * 用于东财期货/商品市场（101 COMEX、102 NYMEX、112 ICE 等）：stock/get 无 fltt 时
   * 这些市场的原始刻度随合约而异（GC×10 / SI×1000 / HG×10000…），f152 不可靠，
   * 按 10^f152 除会得到错误价格并触发区间校验丢弃；ulist 路径与分时页「基础信息」同源同构。
   */
  | 'em_ulist'

/** fetchAccurate 的数据源描述（docs/tabbar-api.md 5.1） */
export interface QuoteSource {
  kind: QuoteSourceKind
  /** 新浪 key / 腾讯行情代码（如 usVIX / sh000001），可传数组逐个尝试 */
  key?: string | string[]
  /** 东财 secid（如 100.SPX / 105.NVDA），可传数组逐个尝试 */
  secid?: string | string[]
  /** 价格合理区间 [min,max]，价格不在区间内的源直接丢弃 */
  min?: number
  max?: number
}

// ---------------------------------------------------------------------------
// 东财美股排行榜（clist/get，docs/us-top100-api.md）
// ---------------------------------------------------------------------------

/** 美股三大市场号：105=纳斯达克 / 106=纽交所 / 107=美交所 */
export type UsMarketNumber = 105 | 106 | 107

/** 美股市值TOP100 单条（东财 clist/get，fid=f20 总市值降序） */
export interface UsTopStock {
  /** 裸代码（如 NVDA / BRK_B） */
  code: string
  /** 东财市场号（用于拼 secid，105=纳斯达克 / 106=纽交所 / 107=美交所） */
  market: UsMarketNumber
  /** 个股 secid（如 105.NVDA / 106.BRK_B），分时与报价同源 */
  secid: string
  /** 中文名（东财返回，如 英伟达；缺失时回退裸代码） */
  name: string
  /** 最新价（停牌/无数据为 null） */
  price: number | null
  /** 涨跌幅 %（无数据为 null） */
  pct: number | null
  /** 涨跌额（无数据为 null） */
  change: number | null
  /** 总市值（美元，东财 f20；无数据为 null） */
  marketCap: number | null
}
