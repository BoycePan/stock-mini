/**
 * 金投网金价外部接口（api.jijinhao.com）—— 金店金价 + 上海黄金交易所实物黄金。
 *
 * 直连微信小程序：GET https://api.jijinhao.com/quoteCenter/realTime.htm?codes=JO_xxx,...
 *
 * 说明：
 * - 免费、无 Key；但接口校验 Referer —— 白名单为 cngold.org / servicewechat.com 来源。
 *   微信 wx.request 无法自定义 Referer（自动带 https://servicewechat.com/{appid}/{version}/page-frame.html），
 *   恰好命中白名单，因此小程序可直连，无需后端代理。
 * - 响应为 JSONP 风格文本：var quote_json = {"flag":true,"JO_42660":{...},"errorCode":[]}
 *   字段：q63=当前价、q70=涨跌额、q80=涨跌幅(%)、unit=单位、time=时间戳(ms)、showName=品类/品种名。
 * - 失败降级为空数组（页面跳过对应分区，不影响整页行情）。
 */

import { goldShopAllCodes } from '../config/gold-shop'
import { physicalGoldCodes } from '../config/physical-gold'
import { requestExternal } from './external'

export interface GoldShopQuote {
  code: string
  item: string
  /** 当前价（黄金/铂金 元/克，白银 元/千克） */
  price: number
  /** 涨跌额 */
  change: number
  /** 涨跌幅（%） */
  pct: number
  unit: string
  /** 行情时间（epoch 毫秒） */
  time: number
}

const GOLD_SHOP_HOST = 'https://api.jijinhao.com'
/** 上游按 Referer 白名单放行；这里显式给 cngold 来源（微信端会被自动 Referer 覆盖，同样命中白名单） */
const GOLD_SHOP_REFERER = 'https://quote.cngold.org/gjs/swhj.html'

/** 按代码列表拉取金价（一次请求；失败返回空数组） */
export async function fetchJijinhaoQuotes(codes: string[]): Promise<GoldShopQuote[]> {
  if (!codes.length) return []
  const url = `${GOLD_SHOP_HOST}/quoteCenter/realTime.htm?codes=${codes.join(',')}`
  try {
    const raw = await requestExternal<string>(url, {
      timeout: 12000,
      referer: GOLD_SHOP_REFERER,
    })
    return parseGoldShopBody(String(raw ?? ''))
  } catch (error) {
    console.warn('[gold-shop] 金价请求失败，跳过该分区:', error)
    return []
  }
}

/** 拉取全部品牌金店报价（一次请求 ~99 个代码） */
export async function fetchGoldShopQuotes(): Promise<GoldShopQuote[]> {
  return fetchJijinhaoQuotes(goldShopAllCodes())
}

/** 拉取上海黄金交易所实物黄金报价（一次请求 8 个品种） */
export async function fetchPhysicalGoldQuotes(): Promise<GoldShopQuote[]> {
  return fetchJijinhaoQuotes(physicalGoldCodes())
}

/** 解析 JSONP 文本（兼容前后空格/分号/换行） */
export function parseGoldShopBody(body: string): GoldShopQuote[] {
  const start = body.indexOf('{')
  const end = body.lastIndexOf('}')
  if (start < 0 || end <= start) return []
  let parsed: unknown
  try {
    parsed = JSON.parse(body.slice(start, end + 1))
  } catch (error) {
    console.warn('[gold-shop] 金店金价响应解析失败:', error)
    return []
  }
  if (typeof parsed !== 'object' || parsed === null) return []

  const quotes: GoldShopQuote[] = []
  for (const [code, node] of Object.entries(parsed as Record<string, Record<string, unknown>>)) {
    if (code === 'flag' || code === 'errorCode') continue
    const price = Number(node?.q63)
    if (!Number.isFinite(price) || price <= 0) continue // 休市/未报价跳过
    quotes.push({
      code,
      item: String(node?.showName ?? ''),
      price,
      change: Number(node?.q70 ?? 0),
      pct: Number(node?.q80 ?? 0),
      unit: String(node?.unit ?? '元/克'),
      time: Number(node?.time ?? 0),
    })
  }
  return quotes
}

export const goldShopApi = {
  fetchQuotes: fetchGoldShopQuotes,
}
