/**
 * 当日分时数据源连通性验证脚本（docs/minute-api.md「验证结果」的可复现版本）。
 *
 * 用法（front/ 目录下）：
 *   node --import ./tests/register.mjs --experimental-strip-types scripts/verify-minute.ts            # 全量
 *   node --import ./tests/register.mjs --experimental-strip-types scripts/verify-minute.ts sh000001   # 单个
 *
 * 对 config/minute.ts 中每个卡片 code 依次尝试 东财 → 腾讯 → Yahoo，
 * 请求 URL 与 api/minute.ts 完全一致，解析复用 utils/minute-parser.ts 纯函数。
 * 打印「code -> 命中源 点数 昨收」，最后汇总统计。
 * 退出码：全部 code 至少命中一个源为 0，否则 1。
 */

import { MINUTE_SOURCES } from '../config/minute.ts'
import {
  buildCompositePoints,
  buildCrossPoints,
  parseEastmoneyTrends,
  parseTencentMinuteNode,
  parseYahooMinuteResult,
} from '../utils/minute-parser.ts'
import type { MinuteResult } from '../types/stock.ts'

const SLEEP_MS = 200
const EM_URL = 'https://push2delay.eastmoney.com/api/qt/stock/trends2/get'
const TX_URL = 'https://web.ifzq.gtimg.cn/appstock/app/minute/query'
const YH_URL = 'https://query1.finance.yahoo.com/v8/finance/chart'

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

async function fetchText(url: string, headers: Record<string, string> = {}): Promise<string> {
  const response = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0', ...headers } })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return response.text()
}

async function emMinute(secid: string, keepFullTime = false): Promise<MinuteResult | null> {
  const params = [
    `secid=${encodeURIComponent(secid)}`,
    'fields1=f1,f2,f3,f4,f5,f6,f7,f8,f9,f10,f11,f12,f13',
    'fields2=f51,f52,f53,f54,f55,f56,f57,f58',
    'ndays=1',
    'iscr=0',
  ].join('&')
  const text = await fetchText(`${EM_URL}?${params}`)
  const body = JSON.parse(text) as {
    data?: { preClose?: number; name?: string; trends?: string[] }
  }
  return parseEastmoneyTrends(body?.data, keepFullTime ? { keepFullTime: true } : undefined)
}

async function tcMinute(code: string): Promise<MinuteResult | null> {
  const text = await fetchText(`${TX_URL}?code=${encodeURIComponent(code)}`)
  const body = JSON.parse(text) as {
    data?: Record<string, { data?: { data?: string[][] }; qt?: Record<string, unknown[]> }>
  }
  return parseTencentMinuteNode(body?.data?.[code])
}

async function yhMinute(symbol: string): Promise<MinuteResult | null> {
  const text = await fetchText(`${YH_URL}/${encodeURIComponent(symbol)}?range=1d&interval=1m`)
  const body = JSON.parse(text) as {
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
  return parseYahooMinuteResult(body?.chart?.result?.[0])
}

async function verifyOne(code: string): Promise<{ code: string; ok: boolean; detail: string }> {
  const sources = MINUTE_SOURCES[code]
  if (!sources) return { code, ok: false, detail: '无分时源配置' }

  // 美股代理股分时均值合成（us-BKxxxx）：每只代理归一化到昨收 100 后逐分钟取均值
  if (sources.emProxies?.length) {
    const series: Array<{
      name?: string
      points: Array<{ time: string; norm: number; volume: number }>
    }> = []
    for (const secid of sources.emProxies) {
      try {
        const result = await emMinute(secid, true)
        if (result && result.points.length >= 2 && result.preClose && result.preClose > 0) {
          const preClose = result.preClose as number
          series.push({
            name: result.name,
            points: result.points.map((p) => ({
              time: p.time,
              norm: (p.price / preClose) * 100,
              volume: p.volume || 0,
            })),
          })
        }
      } catch {
        // 单只代理失败跳过，其余代理仍可合成
      }
      await sleep(SLEEP_MS)
    }
    if (series.length) {
      const points = buildCompositePoints(series)
      if (points.length >= 2) {
        return {
          code,
          ok: true,
          detail: `东财代理合成 ${sources.emProxies.length}只命中${series.length} ${points.length}点 基准=100`,
        }
      }
    }
    return { code, ok: false, detail: '代理合成分时失败' }
  }

  const tries: Array<[string, () => Promise<MinuteResult | null>]> = []
  // 交叉汇率合成：两腿东财 trends2（keepFullTime）逐分钟相除，与 utils/minute.ts 同口径
  if (sources.emCross) {
    const [num, den] = await Promise.all([
      emMinute(sources.emCross.numerator, true),
      emMinute(sources.emCross.denominator, true),
    ])
    if (num && den) {
      const points = buildCrossPoints(
        { points: num.points.map((p) => ({ time: p.time, price: p.price })) },
        { points: den.points.map((p) => ({ time: p.time, price: p.price })) },
      )
      if (points.length >= 2) {
        return {
          code,
          ok: true,
          detail: `东财交叉(${sources.emCross.numerator}÷${sources.emCross.denominator}) ${points.length}点 昨收=${
            num.preClose !== null && den.preClose
              ? Math.round((num.preClose / den.preClose) * 10000) / 10000
              : '?'
          }`,
        }
      }
    }
    await sleep(SLEEP_MS)
  }

  if (sources.em) tries.push([`东财(${sources.em})`, () => emMinute(sources.em as string)])
  if (sources.tc) tries.push([`腾讯(${sources.tc})`, () => tcMinute(sources.tc as string)])
  if (sources.yahoo)
    tries.push([`Yahoo(${sources.yahoo})`, () => yhMinute(sources.yahoo as string)])

  for (const [label, run] of tries) {
    try {
      const result = await run()
      if (result && result.points.length >= 2) {
        return {
          code,
          ok: true,
          detail: `${label} ${result.points.length}点 昨收=${result.preClose ?? '?'}`,
        }
      }
    } catch {
      // 单个源失败继续尝试下一源
    }
    await sleep(SLEEP_MS)
  }
  return { code, ok: false, detail: '全部源失败' }
}

async function main() {
  const only = process.argv.slice(2).filter((arg) => !arg.startsWith('-'))
  const codes = only.length ? only : Object.keys(MINUTE_SOURCES)

  const results: Array<{ code: string; ok: boolean; detail: string }> = []
  for (const code of codes) {
    const result = await verifyOne(code)
    results.push(result)
    console.log(`${result.ok ? 'OK  ' : 'FAIL'} ${code.padEnd(10)} ${result.detail}`)
  }

  const failed = results.filter((r) => !r.ok)
  console.log(
    `\n共 ${results.length} 个 code，命中 ${results.length - failed.length}，失败 ${failed.length}`,
  )
  if (failed.length) {
    console.log('失败项：' + failed.map((r) => r.code).join(', '))
    process.exitCode = 1
  }
}

void main()
