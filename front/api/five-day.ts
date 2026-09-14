/**
 * 五日分时（多日分钟线）外部接口封装（纯前端直连国内公开行情）。
 *
 * 为什么单独一个模块：东财 `trends2` 的 `ndays=5` 在延迟节点被静默忽略（见
 * utils/five-day-parser.ts 头部注释），五日需要独立的数据源与兜底链，
 * 与 api/minute.ts 的「当日分时」分开维护，避免把当日链路的语义搅混。
 *
 * 源：
 *   1. 东财 push2 非延迟节点 trends2 ndays=5（api/minute.ts 的 host 参数，覆盖最广）；
 *   2. 腾讯 web.ifzq.gtimg.cn/appstock/app/day/query（A股 / 港股 / A股指数，实测 5 个交易日 × 1 分钟）；
 *   3. 新浪 A股 5 分钟 K 线（money.finance.sina.com.cn，240 根 ≈ 5 个交易日）。
 */

import type { MinuteResult } from '../types/stock'
import { requestExternal } from './external'
import { parseSinaFiveMinuteBars, parseTencentFiveDay } from '../utils/five-day-parser'

const HOSTS = {
  tencent: 'https://web.ifzq.gtimg.cn',
  sinaAshare: 'https://money.finance.sina.com.cn',
} as const

/**
 * 腾讯五日：GET /appstock/app/day/query?code=<code>
 * 返回最近 5 个交易日（由新到旧）的 1 分钟数据，单日行包含累计量与累计额。
 */
export async function fetchTencentFiveDay(code: string): Promise<MinuteResult | null> {
  const url = `${HOSTS.tencent}/appstock/app/day/query?code=${encodeURIComponent(code)}`
  try {
    const body = await requestExternal<{ code?: number; data?: Record<string, unknown> }>(url, {
      timeout: 12000,
      referer: 'https://gu.qq.com/',
    })
    return parseTencentFiveDay(body)
  } catch (error) {
    console.warn(`[five-day] 腾讯五日失败 ${code}:`, error)
    return null
  }
}

/**
 * 新浪 A股 5 分钟 K 线：240 根 ≈ 5 个交易日（48 根/日），用于 A股 / A股指数量价最简兜底。
 * 出参为 JSON 数组（`[{day, open, high, low, close, volume}]`），day 含日期与时间。
 */
export async function fetchSinaFiveDay(code: string): Promise<MinuteResult | null> {
  const url =
    `${HOSTS.sinaAshare}/quotes_service/api/json_v2.php/CN_MarketData.getKLineData` +
    `?symbol=${encodeURIComponent(code)}&scale=5&ma=no&datalen=240`
  try {
    const body = await requestExternal<unknown>(url, {
      timeout: 12000,
      referer: 'https://finance.sina.com.cn',
    })
    const points = parseSinaFiveMinuteBars(body)
    if (points.length < 2) return null
    return { preClose: points[0]?.price ?? null, points }
  } catch (error) {
    console.warn(`[five-day] 新浪五日失败 ${code}:`, error)
    return null
  }
}

export const fiveDayApi = {
  tencent: fetchTencentFiveDay,
  sina: fetchSinaFiveDay,
}
