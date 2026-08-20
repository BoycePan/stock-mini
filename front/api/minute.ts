/**
 * 当日分时接口统一封装（docs/minute-api.md）。
 *
 * 与 api/quote.ts 同风格：单接口失败「降级为 null / 空数据」而非抛错，
 * 由 utils/minute.ts 按 东财 → 腾讯 → Yahoo 兜底链补齐。
 */

import type { MinuteResult } from '../types/stock'
import { requestExternal } from './external'
import {
  parseEastmoneyTrends,
  parseTencentMinuteNode,
  parseYahooMinuteResult,
} from '../utils/minute-parser'

const HOSTS = {
  /** 东财分时（与首页报价同域 push2delay，已在小程序合法域名内） */
  emTrends: 'https://push2delay.eastmoney.com',
  /** 腾讯分时 */
  tencentMinute: 'https://web.ifzq.gtimg.cn',
  /** Yahoo 1分钟线（补充东财/腾讯分时不覆盖的标的） */
  yahoo: 'https://query1.finance.yahoo.com',
} as const

// ---------------------------------------------------------------------------
// 东方财富分时：GET /api/qt/stock/trends2/get（ndays=1 当日分钟线）
// 出参 data.preClose（昨收）+ data.trends = ["2026-08-19 09:30,现价,...,成交量,成交额,均价", ...]
// 行字段（fields2=f51..f58）：[0]时间 [1]现价 [5]成交量 [6]成交额 [7]均价
// ---------------------------------------------------------------------------

interface EastmoneyTrendsBody {
  data?: {
    preClose?: number
    /** 证券名（美股如「英伟达」，供代理股合成标注中文名） */
    name?: string
    trends?: string[]
  }
}

export async function fetchEastmoneyMinute(
  secid: string,
  opts?: { keepFullTime?: boolean },
): Promise<MinuteResult | null> {
  const params = [
    `secid=${encodeURIComponent(secid)}`,
    'fields1=f1,f2,f3,f4,f5,f6,f7,f8,f9,f10,f11,f12,f13',
    'fields2=f51,f52,f53,f54,f55,f56,f57,f58',
    'ndays=1',
    'iscr=0',
  ].join('&')
  const url = `${HOSTS.emTrends}/api/qt/stock/trends2/get?${params}`
  try {
    const body = await requestExternal<EastmoneyTrendsBody>(url, { timeout: 10000 })
    // keepFullTime：保留完整时间戳（美股代理股合成需要跨零点对齐），默认输出 HH:mm
    return parseEastmoneyTrends(body?.data, opts)
  } catch (error) {
    console.warn(`[minute] 东财分时失败 ${secid}:`, error)
    return null
  }
}

// ---------------------------------------------------------------------------
// 腾讯分时：GET /appstock/app/minute/query?code=<code>
// 出参 data.<code>.data.data = [["0930","现价","成交量","成交额"], ...]（A股/港股）
// data.<code>.qt.<code> 为腾讯报价数组（[4]=昨收）；均价由 累计成交额/累计成交量 推算
// ---------------------------------------------------------------------------

interface TencentMinuteBody {
  data?: Record<
    string,
    {
      data?: { data?: string[][] }
      qt?: Record<string, unknown[]>
    }
  >
}

export async function fetchTencentMinute(code: string): Promise<MinuteResult | null> {
  const url = `${HOSTS.tencentMinute}/appstock/app/minute/query?code=${encodeURIComponent(code)}`
  try {
    const body = await requestExternal<TencentMinuteBody>(url, { timeout: 10000 })
    return parseTencentMinuteNode(body?.data?.[code])
  } catch (error) {
    console.warn(`[minute] 腾讯分时失败 ${code}:`, error)
    return null
  }
}

// ---------------------------------------------------------------------------
// Yahoo 1分钟线：GET /v8/finance/chart/<symbol>?range=1d&interval=1m
// 出参 chart.result[0].timestamp（epoch秒）+ indicators.quote[0]（open/high/low/close/volume）
// meta.chartPreviousClose = 昨收；均价由 1分钟成交额累计/成交量累计 推算（成交额≈价×量）
// ---------------------------------------------------------------------------

interface YahooChartBody {
  chart?: {
    result?: Array<{
      meta?: { chartPreviousClose?: number }
      timestamp?: number[]
      indicators?: {
        quote?: Array<
          Partial<Record<'open' | 'high' | 'low' | 'close' | 'volume', Array<number | null>>>
        >
      }
    }>
  }
}

export async function fetchYahooMinute(symbol: string): Promise<MinuteResult | null> {
  const url = `${HOSTS.yahoo}/v8/finance/chart/${encodeURIComponent(symbol)}?range=1d&interval=1m`
  try {
    const body = await requestExternal<YahooChartBody>(url, { timeout: 10000 })
    const result = body?.chart?.result?.[0]
    return parseYahooMinuteResult(result)
  } catch (error) {
    console.warn(`[minute] Yahoo分时失败 ${symbol}:`, error)
    return null
  }
}

export const minuteApi = {
  eastmoney: fetchEastmoneyMinute,
  tencent: fetchTencentMinute,
  yahoo: fetchYahooMinute,
}
