/**
 * 行情外部接口统一封装（docs/tabbar-api.md ①-④）。
 *
 * 页面 / 业务层只依赖本模块与 utils/quote.ts，不直接拼外部 URL。
 * 所有接口在请求失败时「降级为空数据」而非抛错：新浪/腾讯返回空行、东财返回 null / 空 map，
 * 由调用方按多源兜底链（新浪 → 腾讯 → 东财）自行补齐，避免单源故障拖垮整页。
 */

import type { EastmoneyQuote, EastmoneyUlistQuote, SinaRow, TencentQuote } from '../types/quote'
import {
  normalizeEastmoneyQuote,
  parseEastmoneyAveragePrice,
  parseEastmoneyUlistQuote,
  parseSinaText,
  parseTencentText,
  tencentQuoteOf,
  type EastmoneyAveragePrice,
  type EastmoneyAveragePriceRaw,
  type EastmoneyRaw,
  type EastmoneyUlistQuoteRaw,
} from '../utils/quote-parser'
import { rawBytesToString, requestExternal } from './external'

const HOSTS = {
  tencent: 'https://qt.gtimg.cn',
  sina: 'https://hq.sinajs.cn',
  eastmoney: 'https://push2delay.eastmoney.com',
  eastmoneyPush2: 'https://push2.eastmoney.com',
} as const

// ---------------------------------------------------------------------------
// ① 腾讯行情：GET https://qt.gtimg.cn/q=<codes>
// ---------------------------------------------------------------------------

export async function fetchTencentQuotes(codes: string[]): Promise<TencentQuote[]> {
  if (!codes.length) return []
  const url = `${HOSTS.tencent}/q=${codes.join(',')}`
  try {
    // 腾讯返回 GBK 文本，微信默认 UTF-8 解码在真机会直接失败；改为原始字节 + 逐字节保留
    const raw = await requestExternal<ArrayBuffer>(url, {
      timeout: 10000,
      referer: 'https://qt.gtimg.cn',
      responseType: 'arraybuffer',
    })
    const text = rawBytesToString(raw)
    const map = parseTencentText(text, codes)
    return codes.map((code) => tencentQuoteOf(code, map.get(code) ?? []))
  } catch (error) {
    console.warn('[quote] 腾讯行情请求失败:', error)
    return codes.map((code) => tencentQuoteOf(code, []))
  }
}

// ---------------------------------------------------------------------------
// ② 新浪行情：GET https://hq.sinajs.cn/list=<keys>
// ---------------------------------------------------------------------------

export async function fetchSinaQuotes(keys: string[]): Promise<SinaRow[]> {
  if (!keys.length) return []
  const url = `${HOSTS.sina}/list=${keys.join(',')}`
  try {
    // 新浪返回 GBK 文本，微信默认 UTF-8 解码在真机会直接失败（response data convert to UTF8 fail）；
    // 改为原始字节 + 逐字节保留，GBK 中文名由上层 displayName() 回退配置名兜底，数值字段不受影响。
    const raw = await requestExternal<ArrayBuffer>(url, {
      timeout: 12000,
      referer: 'https://finance.sina.com.cn',
      responseType: 'arraybuffer',
    })
    const text = rawBytesToString(raw)
    const map = parseSinaText(text, keys)
    return keys.map((key) => {
      const fields = map.get(key) ?? []
      return { key, fields, raw: fields.join(',') }
    })
  } catch (error) {
    console.warn('[quote] 新浪行情请求失败:', error)
    return keys.map((key) => ({ key, fields: [], raw: '' }))
  }
}

// ---------------------------------------------------------------------------
// ③ 东财个股行情：GET .../api/qt/stock/get?secid=<secid>&fields=<fields>
// ---------------------------------------------------------------------------

const EM_QUOTE_FIELDS = 'f43,f44,f45,f46,f47,f48,f50,f57,f58,f60,f86,f107,f152,f169,f170'

export async function fetchEastmoneyQuote(
  secid: string,
  fields = EM_QUOTE_FIELDS,
): Promise<EastmoneyQuote | null> {
  const url = `${HOSTS.eastmoney}/api/qt/stock/get?secid=${encodeURIComponent(
    secid,
  )}&fields=${fields}`
  try {
    const body = await requestExternal<{ data?: EastmoneyRaw }>(url, { timeout: 10000 })
    return normalizeEastmoneyQuote(secid, body?.data)
  } catch (error) {
    console.warn(`[quote] 东财个股行情失败 ${secid}:`, error)
    return null
  }
}

// ---------------------------------------------------------------------------
// ④ 东财列表行情：GET .../api/qt/ulist.np/get
// 出参 map 同时含完整 secid 与裸代码两个 key（如 "105.NVDA" 与 "NVDA"）
// ---------------------------------------------------------------------------

export interface EastmoneyListItem {
  f12?: string | number
  f13?: string | number
  f3?: number
}

export async function fetchEastmoneyList(secids: string[]): Promise<Record<string, number>> {
  const result: Record<string, number> = {}
  if (!secids.length) return result
  const params = [
    'ut=fa5fd1943c7b386f172d6893dbfba10b',
    'invt=2',
    'fltt=2',
    `secids=${encodeURIComponent(secids.join(','))}`,
    'fields=f12,f13,f3',
  ].join('&')
  const url = `${HOSTS.eastmoney}/api/qt/ulist.np/get?${params}`
  try {
    const body = await requestExternal<{ data?: { diff?: EastmoneyListItem[] } }>(url, {
      timeout: 10000,
    })
    for (const item of body?.data?.diff ?? []) {
      const code = String(item.f12 ?? '')
      const market = String(item.f13 ?? '')
      const pct = typeof item.f3 === 'number' ? item.f3 : null
      if (!code || pct === null || !Number.isFinite(pct)) continue
      result[code] = pct
      result[`${market}.${code}`] = pct
    }
  } catch (error) {
    console.warn('[quote] 东财列表行情失败:', error)
  }
  return result
}

// ---------------------------------------------------------------------------
// ④b 东财全市场A股快照：GET .../api/qt/clist/get（A股平均股价等权自算的数据源）
// fs = 沪深主板 + 创业板 + 科创板（深主板 t:6 / 创业板 t:80 / 沪主板 t:2 / 科创板 t:23），
// 仅取 f2 最新价 / f18 昨收，控制响应体积。
// 覆盖策略：优先单次大页（pz=8000）→ 覆盖不足按 pz=1000 分页补齐 → 仍不足回退
// push2.eastmoney.com 主站（clist 权威端点）。data.total 兼容数字/数字字符串两种形态。
// ---------------------------------------------------------------------------

export interface EastmoneyClistItem {
  f2?: number | string
  f18?: number | string
}

export interface EastmoneyClistPage {
  items: EastmoneyClistItem[]
  /** data.total：满足 fs 过滤条件的全市场股票数（0 = 上游未返回，视为未知） */
  total: number
}

async function fetchEastmoneyClistPage(
  pn: number,
  pz: number,
  host: string = HOSTS.eastmoney,
): Promise<EastmoneyClistPage> {
  const params = [
    `pn=${pn}`,
    `pz=${pz}`,
    'po=1',
    'np=1',
    'ut=fa5fd1943c7b386f172d6893dbfba10b',
    'invt=2',
    'fltt=2',
    'fid=f3',
    'fs=m:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23',
    'fields=f2,f18',
  ].join('&')
  const url = `${host}/api/qt/clist/get?${params}`
  try {
    const body = await requestExternal<{
      data?: { total?: number | string; diff?: EastmoneyClistItem[] }
    }>(url, { timeout: 15000 })
    // total 兼容数字 / 数字字符串（部分响应以字符串返回）
    const raw = body?.data?.total
    const parsed = typeof raw === 'number' ? raw : Number(String(raw ?? '').trim())
    const total = Number.isFinite(parsed) && parsed > 0 ? parsed : 0
    return { items: body?.data?.diff ?? [], total }
  } catch (error) {
    console.warn('[quote] 东财全市场A股快照失败:', error)
    return { items: [], total: 0 }
  }
}

/** 覆盖是否足够：total 已知要求 ≥90% 且 ≥3000 只；total 未知要求 ≥3000 只 */
function hasEnoughCoverage(page: EastmoneyClistPage): boolean {
  if (page.total > 0) {
    return page.items.length >= Math.max(3000, Math.floor(page.total * 0.9))
  }
  return page.items.length >= 3000
}

async function fetchClistAll(host: string): Promise<EastmoneyClistPage> {
  const first = await fetchEastmoneyClistPage(1, 8000, host)
  if (hasEnoughCoverage(first)) return first

  // 分页补齐：total 已知按页数并行拉全；未知逐页追加到空页 / 数量下限为止
  if (first.total > 0) {
    const pageSize = 1000
    const pageCount = Math.ceil(first.total / pageSize)
    const pages = await Promise.all(
      Array.from({ length: pageCount }, (_, index) =>
        fetchEastmoneyClistPage(index + 1, pageSize, host),
      ),
    )
    return { items: pages.flatMap((page) => page.items), total: first.total }
  }
  const items = [...first.items]
  for (let pn = 2; pn <= 10 && items.length < 3000; pn++) {
    const page = await fetchEastmoneyClistPage(pn, 1000, host)
    items.push(...page.items)
    if (page.items.length === 0) break
  }
  return { items, total: 0 }
}

export async function fetchEastmoneyAShareSnapshot(): Promise<EastmoneyClistPage> {
  const primary = await fetchClistAll(HOSTS.eastmoney)
  if (hasEnoughCoverage(primary)) return primary

  // push2delay 覆盖不足时回退 push2 主站（clist 权威端点；生产需将 push2.eastmoney.com 加入合法域名）
  console.warn('[quote] push2delay 全市场快照覆盖不足，回退 push2:', {
    got: primary.items.length,
    total: primary.total,
  })
  const fallback = await fetchClistAll(HOSTS.eastmoneyPush2)
  if (fallback.items.length >= primary.items.length) return fallback
  return primary
}

// ---------------------------------------------------------------------------
// ④c 东财平均股价指数：GET .../api/qt/ulist.np/get?fltt=2&fields=...&secids=47.800005
// 东财官方「A股平均股价」指数（通达信 880003 口径，全市场等权平均）。
// ④d 东财 ulist 报价：同一 URL 与字段集，供分时页「基础信息」取数（与分时同 secid）。
// 字段取自用户指定 URL：f17 今开 / f18 昨收 / f8 换手率 / f15 最高 / f12 代码 /
// f16 最低 / f115 振幅 / f2 最新价 / f14 名称 / f5 成交量 / f6 成交额 / f3 涨跌幅 /
// f20 总市值 / f13 市场 / f145 均价（实测恒 0，未消费）/ f100 涨速 / f265 60日涨跌幅 /
// f266 年初至今涨跌幅。
// ---------------------------------------------------------------------------

const EM_ULIST_FIELDS = 'f17,f18,f8,f15,f12,f16,f115,f2,f14,f5,f6,f3,f20,f13,f145,f100,f265,f266'
/** 东财平均股价指数 secid（市场号 47 = 平均股价指数；调用方可覆盖） */
export const EM_AVG_PRICE_SECID = '47.800005'

export async function fetchEastmoneyAveragePrice(
  secid: string = EM_AVG_PRICE_SECID,
): Promise<EastmoneyAveragePrice | null> {
  const params = [
    'fltt=2',
    `fields=${encodeURIComponent(EM_ULIST_FIELDS)}`,
    `secids=${secid}`,
  ].join('&')
  const url = `${HOSTS.eastmoney}/api/qt/ulist.np/get?${params}`
  try {
    const body = await requestExternal<{ data?: { diff?: EastmoneyAveragePriceRaw[] } }>(url, {
      timeout: 10000,
    })
    return parseEastmoneyAveragePrice(secid, body?.data?.diff?.[0])
  } catch (error) {
    console.warn('[quote] 东财平均股价指数失败:', error)
    return null
  }
}

/** 东财 ulist 报价：今开/最高/最低/昨收/成交量等（分时页基础信息，与分时同 secid） */
export async function fetchEastmoneyUlistQuote(secid: string): Promise<EastmoneyUlistQuote | null> {
  const params = [
    'fltt=2',
    `fields=${encodeURIComponent(EM_ULIST_FIELDS)}`,
    `secids=${secid}`,
  ].join('&')
  const url = `${HOSTS.eastmoney}/api/qt/ulist.np/get?${params}`
  try {
    const body = await requestExternal<{ data?: { diff?: EastmoneyUlistQuoteRaw[] } }>(url, {
      timeout: 10000,
    })
    return parseEastmoneyUlistQuote(secid, body?.data?.diff?.[0])
  } catch (error) {
    console.warn(`[quote] 东财 ulist 报价失败 ${secid}:`, error)
    return null
  }
}

export const quoteApi = {
  tencent: fetchTencentQuotes,
  sina: fetchSinaQuotes,
  eastmoneyQuote: fetchEastmoneyQuote,
  eastmoneyList: fetchEastmoneyList,
  eastmoneyAShareSnapshot: fetchEastmoneyAShareSnapshot,
  eastmoneyAveragePrice: fetchEastmoneyAveragePrice,
  eastmoneyUlistQuote: fetchEastmoneyUlistQuote,
}
