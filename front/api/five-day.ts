/**
 * 五日分时（多日分钟线）外部接口封装（纯前端直连国内公开行情）。
 *
 * 为什么单独一个模块：东财 `trends2` 的 `ndays=5` 在 push2 / push2delay 两个节点都被静默忽略
 * （见 utils/five-day-parser.ts 头部注释），五日需要独立的数据源与兜底链，
 * 与 api/minute.ts 的「当日分时」分开维护，避免把当日链路的语义搅混。
 *
 * 源：
 *   1. 腾讯 web.ifzq.gtimg.cn/appstock/app/dayus/query（美股指数 / 美股个股 ETF，
 *      实测 5 个交易日 × 1 分钟；美股五日唯一可用的国内直连源）；
 *   2. 腾讯 web.ifzq.gtimg.cn/appstock/app/day/query（A股 / 港股 / A股指数，实测 5 个交易日 × 1 分钟）；
 *   3. 新浪 A股 5 分钟 K 线（money.finance.sina.com.cn，240 根 ≈ 5 个交易日）；
 *   4. 东财 push2 trends2 ndays=5（api/minute.ts 的 host 参数，兜底板块 / 期货 / 外汇等无腾讯源的标的）。
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
 * 腾讯美股五日：GET /appstock/app/dayus/query?code=<us 代码>
 * 与 A股 / 港股 day/query 同结构（日序由新到旧、行内为累计量），解析复用 parseTencentFiveDay：
 * `data.<code>.data = [{ date: "20260915", data: ["0930 52251.28 0", …], prec }]`。
 * 覆盖美股指数（usDJI / usINX / usIXIC）与美股个股 / ETF（usNVDA / usTLT / usBATT）；
 * 腾讯无数据的标的（如费半 usSOX）返回空 data 数组 → 解析为 null，由上层继续兜底。
 * 时间口径为**交易所本地时钟**（09:30-16:00 ET），与东财美股分时的北京时间口径不同，
 * 但五日图按自然日分段、以区间首点为 0% 基准，两种口径画出的曲线一致。
 */
export async function fetchTencentUsFiveDay(code: string): Promise<MinuteResult | null> {
  const url = `${HOSTS.tencent}/appstock/app/dayus/query?code=${encodeURIComponent(code)}`
  try {
    const body = await requestExternal<{ code?: number; data?: Record<string, unknown> }>(url, {
      timeout: 12000,
      referer: 'https://gu.qq.com/',
    })
    return parseTencentFiveDay(body)
  } catch (error) {
    console.warn(`[five-day] 腾讯美股五日失败 ${code}:`, error)
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
  tencentUs: fetchTencentUsFiveDay,
  sina: fetchSinaFiveDay,
}
