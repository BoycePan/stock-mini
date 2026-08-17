/**
 * 行情外部接口统一封装（docs/tabbar-api.md ①-⑤）。
 *
 * 页面 / 业务层只依赖本模块与 utils/quote.ts，不直接拼外部 URL。
 * 所有接口在请求失败时「降级为空数据」而非抛错：新浪/腾讯返回空行、东财返回 null / 空 map，
 * 由调用方按多源兜底链（新浪 → 腾讯 → 东财）自行补齐，避免单源故障拖垮整页。
 */

import type { EastmoneyQuote, JumpMpConfig, SinaRow, TencentQuote } from '../types/quote'
import {
  JUMP_MP_DEFAULT,
  normalizeEastmoneyQuote,
  parseJumpMpBody,
  parseSinaText,
  parseTencentText,
  tencentQuoteOf,
  type EastmoneyRaw,
} from '../utils/quote-parser'
import { requestExternal } from './external'

const HOSTS = {
  tencent: 'https://qt.gtimg.cn',
  sina: 'https://hq.sinajs.cn',
  eastmoney: 'https://push2delay.eastmoney.com',
  jumpMp: 'https://douyin.aaaa5.cn',
} as const

// ---------------------------------------------------------------------------
// ① 腾讯行情：GET https://qt.gtimg.cn/q=<codes>
// ---------------------------------------------------------------------------

export async function fetchTencentQuotes(codes: string[]): Promise<TencentQuote[]> {
  if (!codes.length) return []
  const url = `${HOSTS.tencent}/q=${codes.join(',')}`
  try {
    const text = await requestExternal<string>(url, {
      timeout: 10000,
      referer: 'https://qt.gtimg.cn',
    })
    const map = parseTencentText(String(text ?? ''), codes)
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
    const text = await requestExternal<string>(url, {
      timeout: 12000,
      referer: 'https://finance.sina.com.cn',
    })
    const map = parseSinaText(String(text ?? ''), keys)
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
// ⑤ 跳转小程序配置：GET https://douyin.aaaa5.cn/1/3.json?t=<ts>（设置页使用）
// ---------------------------------------------------------------------------

let jumpMpCache: { at: number; config: JumpMpConfig } | null = null
const JUMP_MP_TTL = 60_000

export async function fetchJumpMpConfig(): Promise<JumpMpConfig> {
  const now = Date.now()
  if (jumpMpCache && now - jumpMpCache.at < JUMP_MP_TTL) {
    return jumpMpCache.config
  }
  try {
    const body = await requestExternal<unknown>(`${HOSTS.jumpMp}/1/3.json?t=${now}`, {
      timeout: 8000,
    })
    const config = parseJumpMpBody(body)
    jumpMpCache = { at: now, config }
    return config
  } catch (error) {
    console.warn('[quote] 跳转小程序配置请求失败:', error)
    // 失败回退缓存或默认隐藏配置
    return jumpMpCache?.config ?? { ...JUMP_MP_DEFAULT }
  }
}

export const quoteApi = {
  tencent: fetchTencentQuotes,
  sina: fetchSinaQuotes,
  eastmoneyQuote: fetchEastmoneyQuote,
  eastmoneyList: fetchEastmoneyList,
  jumpMpConfig: fetchJumpMpConfig,
}
