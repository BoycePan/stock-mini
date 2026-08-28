/**
 * 外部行情文本 / JSON 的纯解析函数（docs/tabbar-api.md「解析要点」逐项对齐）。
 *
 * 本模块不发起任何网络请求，只做「文本 / JSON → 结构化数据」，可在 Node 测试中直接复用。
 */

import type { EastmoneyQuote, EastmoneyUlistQuote, SinaQuote, TencentQuote } from '../types/quote'

// ---------------------------------------------------------------------------
// 通用工具
// ---------------------------------------------------------------------------

function toNumber(value: string | number | undefined): number | null {
  if (value === undefined || value === null || value === '') return null
  const cleaned = typeof value === 'string' ? value.replace(/\s+/g, '') : value
  const num = typeof cleaned === 'number' ? cleaned : Number(cleaned)
  return Number.isFinite(num) ? num : null
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** 去掉响应头可能携带的 BOM */
export function stripBom(text: string): string {
  return text.replace(/^\uFEFF/, '')
}

/**
 * 展示名安全回退：外部源（尤其新浪/腾讯 GBK 文本在部分环境未正确解码时）名称乱码时，
 * 使用配置里的兜底名称，避免页面出现乱码。
 */
export function displayName(fetched: string | undefined, fallback: string): string {
  if (!fetched) return fallback
  if (fetched === 'pv_none_match') return fallback
  const hasCjk = /[\u4e00-\u9fff]/.test(fetched)
  const pureAscii = /^[\x20-\x7e]+$/.test(fetched)
  return hasCjk || pureAscii ? fetched : fallback
}

// ---------------------------------------------------------------------------
// ① 腾讯行情文本解析
// ---------------------------------------------------------------------------

/** 腾讯文本每行形如：v_sh000001="上证指数~代码~…~"; 字段按 ~ 拆分 */
export function parseTencentText(text: string, codes: string[]): Map<string, string[]> {
  const cleaned = stripBom(String(text ?? ''))
  const map = new Map<string, string[]>()
  for (const code of codes) {
    const match = cleaned.match(new RegExp(`v_${escapeRegExp(code)}="([^"]*)"`))
    map.set(code, match ? (match[1] ? match[1].split('~') : []) : [])
  }
  return map
}

const TENCENT_REQUIRED_FIELDS = 35

/** 腾讯字段 → 归一化报价（索引规则见 docs/tabbar-api.md ①） */
export function tencentQuoteOf(code: string, fields: string[]): TencentQuote {
  const notMatched = fields[0] === 'pv_none_match' || fields.includes('pv_none_match')
  const valid = fields.length >= TENCENT_REQUIRED_FIELDS && !notMatched
  const num = (index: number): number | null => (valid ? toNumber(fields[index]) : null)

  const latestPrice = num(3)
  const previousClose = num(4)
  let change = num(31)
  if (change === null && latestPrice !== null && previousClose !== null) {
    change = latestPrice - previousClose
  }

  return {
    code,
    name: valid ? (fields[1] ?? '') : '',
    latestPrice,
    previousClose,
    open: num(5),
    high: num(6),
    low: num(7),
    volume: num(8),
    amount: num(9),
    change,
    changePercent: num(32),
    quoteTime: valid ? parseQuoteTime(fields[30] ?? '') : '',
    valid,
  }
}

// ---------------------------------------------------------------------------
// ② 新浪行情文本解析
// ---------------------------------------------------------------------------

/** 新浪文本每行形如：hq_str_hf_GC="GC0,…,昨收,…"; 字段按 , 拆分 */
export function parseSinaText(text: string, keys: string[]): Map<string, string[]> {
  const cleaned = stripBom(String(text ?? ''))
  const map = new Map<string, string[]>()
  for (const key of keys) {
    const match = cleaned.match(new RegExp(`hq_str_${escapeRegExp(key)}="([^"]*)"`))
    map.set(key, match ? (match[1] ? match[1].split(',') : []) : [])
  }
  return map
}

function numAt(fields: string[], index: number): number | null {
  return toNumber(fields[index])
}

/** 新浪字段 → 归一化报价（品类索引规则见 docs/tabbar-api.md ②） */
export function parseSinaQuote(key: string, fields: string[]): SinaQuote {
  const empty = fields.length === 0 || (fields.length === 1 && fields[0] === '')
  if (empty) {
    return { key, price: null, previousClose: null, change: null, changePercent: null }
  }

  // 贵金属 hf_*：现价 [0]、昨收 [7]
  if (key.startsWith('hf_')) {
    return sinaWithPrevClose(key, fields, 0, 7)
  }
  // 非金属（国内期货）nf_*：现价 [8]、昨收 [10]
  if (key.startsWith('nf_')) {
    return sinaWithPrevClose(key, fields, 8, 10)
  }
  // 指数 znb_* / int_nikkei：现价 [1]、涨跌额 [2]、涨跌幅 [3]
  if (key.startsWith('znb_') || key.startsWith('int_')) {
    return sinaIndex(key, fields)
  }
  // 美元指数 DINIW：现价 [1]、昨收 [3]（与新浪 fx_ 外汇同布局：今开 [5]、最高 [6]、最低 [7]、
  // 名称 [9]、日期 [10]；无 fx_ 的 [10] 涨跌幅/[11] 涨跌额，涨跌幅需由 现价-昨收 反推）。
  // 实测 2026-08-22 快照与东财 100.UDI 对照验证：最高 [6]=98.9129≈东财 98.91、最低 [7]=98.5615≈
  // 东财 98.56（[7] 是当日最低，不是昨收——早期误把 [7] 当昨收会把涨跌幅虚高到 +0.29%，
  // 且被 fetchAccurate 共识取中位数混成 +0.13%，与分时页（东财 100.UDI）的 -0.02% 不一致）。
  if (key.toUpperCase() === 'DINIW') {
    const price = numAt(fields, 1)
    const prev = numAt(fields, 3)
    return sinaWithPrevCloseValues(key, price, prev)
  }
  // 美股 gb_*（宏观资产消费方，quote.js sina_gb）：现价 [1]、昨收 [2]、涨跌幅 [3]
  if (key.startsWith('gb_')) {
    return sinaGb(key, fields)
  }
  // 外汇 fx_*：现价 [1]、昨收 [3]；新浪自带 [10] 涨跌幅(%)、[11] 涨跌额（缺失时反推）
  if (key.startsWith('fx_')) {
    return sinaFx(key, fields)
  }
  // A股 / 指数（sh000001 等）：名称[0] 今开[1] 昨收[2] 现价[3] …
  return sinaWithPrevClose(key, fields, 3, 2)
}

function sinaWithPrevClose(
  key: string,
  fields: string[],
  priceIndex: number,
  prevIndex: number,
): SinaQuote {
  return sinaWithPrevCloseValues(key, numAt(fields, priceIndex), numAt(fields, prevIndex))
}

function sinaWithPrevCloseValues(
  key: string,
  price: number | null,
  previousClose: number | null,
): SinaQuote {
  if (price === null) {
    return { key, price, previousClose, change: null, changePercent: null }
  }
  let change: number | null = null
  let changePercent: number | null = null
  if (previousClose !== null && previousClose !== 0) {
    change = price - previousClose
    changePercent = (change / previousClose) * 100
  }
  return { key, price, previousClose, change, changePercent }
}

function sinaIndex(key: string, fields: string[]): SinaQuote {
  const price = numAt(fields, 1)
  const change = numAt(fields, 2)
  const changePercent = numAt(fields, 3)
  return { key, price, previousClose: null, change, changePercent }
}

function sinaGb(key: string, fields: string[]): SinaQuote {
  const price = numAt(fields, 1)
  const previousClose = numAt(fields, 2)
  let changePercent = numAt(fields, 3)
  if (changePercent === null) {
    // 涨跌幅缺失时从末尾 8 个字段中取首个 |值|<80 的数字
    changePercent = lastEightDigitsPct(fields)
  }
  let change: number | null = null
  if (price !== null && previousClose !== null) {
    change = price - previousClose
    if (changePercent === null && previousClose !== 0) {
      changePercent = (change / previousClose) * 100
    }
  }
  return { key, price, previousClose, change, changePercent }
}

/**
 * 新浪 fx_ 外汇：现价 [1]、昨收 [3]；新浪自带 [10] 涨跌幅(%)、[11] 涨跌额，
 * 缺失时由 现价-昨收 反推（实测 5 个汇率 key，[11] = 现价-昨收、[10] = 涨跌幅均吻合）。
 */
function sinaFx(key: string, fields: string[]): SinaQuote {
  const price = numAt(fields, 1)
  const previousClose = numAt(fields, 3)
  if (price === null) {
    return { key, price, previousClose, change: null, changePercent: null }
  }
  let change = numAt(fields, 11)
  let changePercent = numAt(fields, 10)
  if (changePercent === null && previousClose !== null && previousClose !== 0) {
    if (change === null) change = price - previousClose
    changePercent = (change / previousClose) * 100
  }
  return { key, price, previousClose, change, changePercent }
}

/** 美股代理股涨跌幅（fetchUsProxyChangeMap 消费方）：直接取 [2]（docs ② gb_ 差异说明） */
export function sinaGbProxyPct(fields: string[]): number | null {
  const pct = toNumber(fields[2])
  if (pct === null || Math.abs(pct) >= 80) return null
  return pct
}

/**
 * 新浪 gb_ 美股盘前字段（实测 36 字段布局，见 docs/tabbar-api.md ②）：
 * [21] 盘前价 / [22] 盘前涨跌幅% / [23] 盘前涨跌额 / [24] 盘前时间（如 "Aug 26 05:29AM EDT"）。
 * 数据源与取数口径对齐参考脚本 us-sector-premarket.js（新浪 hq.sinajs.cn 实时盘前）。
 */
export interface SinaGbPremarket {
  /** 盘前价 [21] */
  price: number | null
  /** 盘前涨跌幅% [22]（板块等权均值消费方） */
  pct: number | null
  /** 盘前涨跌额 [23] */
  chg: number | null
  /** 盘前时间原始串 [24] */
  time: string
}

export function sinaGbPremarketFields(fields: string[]): SinaGbPremarket {
  return {
    price: numAt(fields, 21),
    pct: numAt(fields, 22),
    chg: numAt(fields, 23),
    time: fields[24] ?? '',
  }
}

const SINA_MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
]

export interface SinaPremarketTime {
  hour: number
  minute: number
  /** 是否为美东当天（盘前实时性判定，见 utils/quote.ts fetchUsProxyPremarketMap） */
  isToday: boolean
}

/**
 * 解析新浪盘前时间串 "Aug 26 05:29AM EDT" / "Jan 15 08:10AM EST" → 结构化时间。
 * 与当前美东日期（etNow = { month: 1-12, day }，DST 感知由调用方经 market-clock 换算）比对得 isToday。
 * 注意：参考脚本 us-sector-premarket.js 仅匹配 EDT（冬令时 EST 会失效），此处兼容 EDT|EST。
 * 无法识别返回 null（该成分视为无实时盘前数据，剔除出板块均值）。
 */
export function parseSinaPremarketTime(
  time: string,
  etNow: { month: number; day: number },
): SinaPremarketTime | null {
  if (!time) return null
  const m = time.match(/^(\w{3})\s+(\d{1,2})\s+(\d{1,2}):(\d{2})(AM|PM)\s+(EDT|EST)/i)
  if (!m) return null
  const mo = SINA_MONTHS.indexOf(m[1]![0]!.toUpperCase() + m[1]!.slice(1).toLowerCase())
  if (mo < 0) return null
  let hour = parseInt(m[3]!, 10)
  const minute = parseInt(m[4]!, 10)
  const isPm = m[5]!.toUpperCase() === 'PM'
  if (isPm && hour < 12) hour += 12
  if (!isPm && hour === 12) hour = 0
  return { hour, minute, isToday: mo + 1 === etNow.month && parseInt(m[2]!, 10) === etNow.day }
}

function lastEightDigitsPct(fields: string[]): number | null {
  const tail = fields.slice(-8)
  for (const value of tail) {
    const num = toNumber(value)
    if (num !== null && Math.abs(num) < 80) return num
  }
  return null
}

// ---------------------------------------------------------------------------
// 行情时间解析（[30] 可为 数字秒/毫秒、yyyyMMddHHmmss、yyyy-MM-dd HH:mm:ss）
// ---------------------------------------------------------------------------

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

/** 归一化为 yyyy-MM-dd HH:mm:ss；无法识别时返回原串 */
export function parseQuoteTime(value: string): string {
  if (!value) return ''
  const str = String(value).trim()
  if (/^\d+$/.test(str)) {
    // 14 位 19xx/20xx 开头视为 yyyyMMddHHmmss（腾讯 A 股格式），优先于毫秒时间戳判断
    const compact = str.match(/^(19|20)(\d{12})$/)
    if (compact) {
      return `${str.slice(0, 4)}-${str.slice(4, 6)}-${str.slice(6, 8)} ${str.slice(
        8,
        10,
      )}:${str.slice(10, 12)}:${str.slice(12, 14)}`
    }
    const num = Number(str)
    if (num >= 1e12) return formatDateTime(num) // 毫秒
    if (num >= 1e8) return formatDateTime(num * 1000) // 秒
    return str
  }
  const compact = str.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/)
  if (compact) {
    return `${compact[1]}-${compact[2]}-${compact[3]} ${compact[4]}:${compact[5]}:${compact[6]}`
  }
  const iso = str.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/)
  if (iso) {
    return `${iso[1]}-${iso[2]}-${iso[3]} ${iso[4]}:${iso[5]}${iso[6] ? `:${iso[6]}` : ':00'}`
  }
  return str
}

function formatDateTime(ms: number): string {
  const date = new Date(ms)
  if (Number.isNaN(date.getTime())) return ''
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

/** 解析行情时间为 Date（用于活跃度 / 新鲜度判定）；无法识别返回 null */
export function quoteTimeToDate(value: string): Date | null {
  if (!value) return null
  const str = String(value).trim()
  if (/^\d+$/.test(str)) {
    // 14 位 19xx/20xx 开头视为 yyyyMMddHHmmss（北京时间本地解析）
    if (/^(19|20)\d{12}$/.test(str)) {
      return toValidDate(
        new Date(
          Number(str.slice(0, 4)),
          Number(str.slice(4, 6)) - 1,
          Number(str.slice(6, 8)),
          Number(str.slice(8, 10)),
          Number(str.slice(10, 12)),
          Number(str.slice(12, 14)),
        ).getTime(),
      )
    }
    const num = Number(str)
    if (num >= 1e12) return toValidDate(num)
    if (num >= 1e8) return toValidDate(num * 1000)
    return null
  }
  const compact = str.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/)
  if (compact) {
    return toValidDate(
      new Date(
        Number(compact[1]),
        Number(compact[2]) - 1,
        Number(compact[3]),
        Number(compact[4]),
        Number(compact[5]),
        Number(compact[6]),
      ).getTime(),
    )
  }
  const iso = str.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/)
  if (iso) {
    return toValidDate(
      new Date(
        Number(iso[1]),
        Number(iso[2]) - 1,
        Number(iso[3]),
        Number(iso[4]),
        Number(iso[5]),
        iso[6] ? Number(iso[6]) : 0,
      ).getTime(),
    )
  }
  return null
}

function toValidDate(ms: number): Date | null {
  const date = new Date(ms)
  return Number.isNaN(date.getTime()) ? null : date
}

// ---------------------------------------------------------------------------
// ③ 东财个股行情（stock/get）归一化
// ---------------------------------------------------------------------------

export interface EastmoneyRaw {
  f57?: string | number
  f58?: string
  f43?: number
  f44?: number
  f45?: number
  f46?: number
  f60?: number
  f169?: number
  f170?: number
  f86?: number
  f107?: number
  f152?: number
  f47?: number
  f48?: number
}

/** 价格除数：10^(f152||2)；部分市场恒除数（实测，见 docs/tabbar-api.md「④ 东财个股行情」）：
 * - 116 港股：恒除 1000（如 00700 f43=451400 → 451.4）
 * - 177 韩股：原值不除（如 005930 f43=271000 → 271000，KRW 整元）
 * - 176 日股：恒除 10（如 8035 f43=540200 → 54020，10 日元为单位）
 * 其余市场按 10^(f152||2)。 */
export function priceDivisor(f152: number | undefined, market: number | undefined): number {
  if (market === 116) return 1000
  if (market === 177) return 1
  if (market === 176) return 10
  return Math.pow(10, f152 ?? 2)
}

const MARKET_NAMES: Record<string, string> = {
  '0': '深市',
  '1': '沪市',
  '90': '板块',
  '100': '指数',
  '105': '美股',
  '106': '美股',
  '107': '美股',
  '116': '港股',
  '119': '汇率',
  '176': '日股',
  '177': '韩股',
  '251': '指数',
}

export function marketNameOf(market: string | number): string {
  return MARKET_NAMES[String(market)] ?? '其他市场'
}

/** 东财 stock/get 原始 data → 归一化报价；data.f57/f58 为空返回 null（行情为空） */
export function normalizeEastmoneyQuote(
  secid: string,
  data: EastmoneyRaw | null | undefined,
): EastmoneyQuote | null {
  if (!data || !data.f57 || !data.f58) return null
  const divisor = priceDivisor(data.f152, data.f107)
  const div = (value: number | undefined): number | null =>
    typeof value === 'number' && Number.isFinite(value) ? value / divisor : null

  const latestPrice = div(data.f43)
  const previousClose = div(data.f60)
  let change = div(data.f169)
  if (change === null && latestPrice !== null && previousClose !== null) {
    change = latestPrice - previousClose
  }

  const quoteTimestamp =
    typeof data.f86 === 'number' && Number.isFinite(data.f86) ? data.f86 * 1000 : null
  const isStale = quoteTimestamp === null || Date.now() - quoteTimestamp > 4 * 3600 * 1000

  return {
    secid,
    code: String(data.f57),
    name: String(data.f58),
    marketName: marketNameOf(data.f107 ?? String(secid).split('.')[0] ?? ''),
    latestPrice,
    previousClose,
    open: div(data.f46),
    high: div(data.f44),
    low: div(data.f45),
    change,
    changePercent: typeof data.f170 === 'number' ? data.f170 / 100 : null,
    volume: typeof data.f47 === 'number' ? data.f47 : null,
    amount: typeof data.f48 === 'number' ? data.f48 : null,
    quoteTimestamp,
    quoteTime: quoteTimestamp === null ? '' : formatDateTime(quoteTimestamp),
    isStale,
  }
}

// ---------------------------------------------------------------------------
// ③c 东财平均股价指数（ulist.np/get，secid 47.800005）
// 东财官方「A股平均股价」指数（通达信 880003 口径，全市场等权平均）：
// f2=最新价、f3=涨跌幅(%)、f18=昨收、f14=名称、f12=代码、f13=市场。
// fltt=2 下价格与涨跌幅均为十进制数（无需再 ÷100）。
// ---------------------------------------------------------------------------

export interface EastmoneyAveragePriceRaw {
  f12?: string | number
  f13?: string | number
  f14?: string
  f2?: number | string
  f3?: number | string
  f18?: number | string
}

export interface EastmoneyAveragePrice {
  secid: string
  code: string
  name: string
  price: number | null
  previousClose: number | null
  changePercent: number | null
}

/** ulist diff 条目 → 平均股价归一化报价；缺 f2（最新价）返回 null */
export function parseEastmoneyAveragePrice(
  secid: string,
  raw: EastmoneyAveragePriceRaw | null | undefined,
): EastmoneyAveragePrice | null {
  if (!raw) return null
  const price = toNumber(raw.f2)
  if (price === null) return null
  return {
    secid,
    code: String(raw.f12 ?? ''),
    name: typeof raw.f14 === 'string' ? raw.f14 : '',
    price,
    previousClose: toNumber(raw.f18),
    changePercent: toNumber(raw.f3),
  }
}

// ---------------------------------------------------------------------------
// ④d 东财 ulist 报价（ulist.np/get，分时页「基础信息」取数，与分时同 secid）
// fltt=2 下价格为十进制：f2 最新价 / f3 涨跌幅 / f17 今开 / f15 最高 / f16 最低 /
// f18 昨收 / f5 成交量 / f6 成交额 / f14 名称 / f12 代码 / f13 市场号。
// 注：字段清单里的 f145（均价）实测恒为 0，均价仍取分时末点均价（trends2 f58）。
// ---------------------------------------------------------------------------

export interface EastmoneyUlistQuoteRaw {
  f12?: string | number
  f13?: string | number
  f14?: string
  f2?: number | string
  f3?: number | string
  f5?: number | string
  f6?: number | string
  f15?: number | string
  f16?: number | string
  f17?: number | string
  f18?: number | string
}

/** ulist diff 条目 → 归一化报价；缺 f2（最新价）返回 null */
export function parseEastmoneyUlistQuote(
  secid: string,
  raw: EastmoneyUlistQuoteRaw | null | undefined,
): EastmoneyUlistQuote | null {
  if (!raw) return null
  const price = toNumber(raw.f2)
  if (price === null) return null
  return {
    secid,
    code: String(raw.f12 ?? ''),
    market: String(raw.f13 ?? ''),
    name: typeof raw.f14 === 'string' ? raw.f14 : '',
    price,
    changePercent: toNumber(raw.f3),
    open: toNumber(raw.f17),
    high: toNumber(raw.f15),
    low: toNumber(raw.f16),
    previousClose: toNumber(raw.f18),
    volume: toNumber(raw.f5),
    amount: toNumber(raw.f6),
  }
}

// ---------------------------------------------------------------------------
// 数据校验（docs「解析要点」）
// ---------------------------------------------------------------------------

/** 价格是否落在合理区间 [min,max]（区间校验，见有色页 aExtra/usExtra） */
export function validateQuote(price: number | null, min?: number, max?: number): boolean {
  if (price === null || !Number.isFinite(price)) return false
  if (min !== undefined && price < min) return false
  if (max !== undefined && price > max) return false
  return true
}

/** 涨跌幅是否异常（|pct| >= 80 视为异常数据丢弃；未知 null 不算异常） */
export function isAbnormalPct(pct: number | null | undefined): boolean {
  return pct !== null && pct !== undefined && Math.abs(pct) >= 80
}
