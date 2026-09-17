/**
 * K 线（日/周/月/年）数据源连通性验证脚本（docs/卡片与分时数据源映射.md「复验方式」的可复现版本）。
 *
 * 与 verify-minute.ts 的区别：K 线取数在 api/kline.ts 里走 `requestExternal`（wx.request），
 * 因此本脚本先注入 `./wx-shim.ts` 的 fetch 版 `wx.request` 垫片，再直接调用**生产代码路径**
 * `fetchKlineSeries(code, tab)`（utils/kline-source.ts：东财 → 腾讯 → 新浪兜底 + 周期聚合 + 合成标的），
 * 这样验证的就是小程序真实会走的链路，而不是脚本里另写一套请求。
 *
 * 用法（front/ 目录下）：
 *   node --import ./tests/register.mjs --experimental-strip-types scripts/verify-kline.ts           # 全量
 *   node --import ./tests/register.mjs --experimental-strip-types scripts/verify-kline.ts sh600519  # 单个
 *
 * 验证范围 = config/minute.ts 的 MINUTE_SOURCES 全部 code（测试强制「有分时源 ⇒ 有 K 线源」），
 * 每个 code 跑日/周/月/年四个 TAB，打印「bars / 来源」，最后汇总统计。
 * 退出码：全部 code 的四个 TAB 都有数据为 0，否则 1。
 */

import { MINUTE_SOURCES } from '../config/minute.ts'
import { resolveKlineSources } from '../config/kline.ts'
import { clearKlineCache, fetchKlineSeries, type KlineTab } from '../utils/kline-source.ts'
import { installWxRequestShim } from './wx-shim.ts'

const TABS: KlineTab[] = ['day', 'week', 'month', 'year']
const SLEEP_MS = 120

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

async function verifyOne(
  code: string,
): Promise<{ code: string; ok: boolean; detail: string; failedTabs: string[] }> {
  const sources = resolveKlineSources(code)
  if (!sources) return { code, ok: false, detail: '无 K 线源配置', failedTabs: [...TABS] }
  // 每个 code 独立清缓存，避免上一条 code 的 60s 缓存掩盖本次真实取数
  clearKlineCache(code)

  const parts: string[] = []
  const failedTabs: string[] = []
  for (const tab of TABS) {
    let detail = '空'
    try {
      const result = await fetchKlineSeries(code, tab)
      if (result && result.klines.length >= 2) {
        detail = `${result.klines.length}根/${result.sourceLabel}`
      } else {
        failedTabs.push(tab)
      }
    } catch (error) {
      failedTabs.push(tab)
      detail = `异常:${error instanceof Error ? error.message : String(error)}`
    }
    parts.push(`${tab}=${detail}`)
    await sleep(SLEEP_MS)
  }
  return { code, ok: failedTabs.length === 0, detail: parts.join('  '), failedTabs }
}

async function main() {
  installWxRequestShim()
  const only = process.argv.slice(2).filter((arg) => !arg.startsWith('-'))
  const codes = only.length ? only : Object.keys(MINUTE_SOURCES)

  const results: Array<{ code: string; ok: boolean; detail: string; failedTabs: string[] }> = []
  for (const code of codes) {
    const result = await verifyOne(code)
    results.push(result)
    console.log(
      `${result.ok ? 'OK  ' : 'FAIL'} ${code.padEnd(10)} ${result.detail}${
        result.failedTabs.length ? ` ← 失败:${result.failedTabs.join(',')}` : ''
      }`,
    )
  }

  const failed = results.filter((r) => !r.ok)
  console.log(
    `\n共 ${results.length} 个 code（每个 4 个 TAB），全部 TAB 有数据 ${
      results.length - failed.length
    }，存在失败 ${failed.length}`,
  )
  if (failed.length) {
    console.log('失败项：' + failed.map((r) => `${r.code}[${r.failedTabs.join('/')}]`).join(', '))
    process.exitCode = 1
  }
}

void main()
