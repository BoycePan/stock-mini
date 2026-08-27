/**
 * 美股市值TOP100 解析与展示格式化（纯函数，docs/us-top100-api.md）。
 *
 * 数据源：东财延迟行情 clist/get（push2delay.eastmoney.com，与首页行情同域，
 * 已在小程序合法域名内），fs=m:105,m:106,m:107 + fid=f20 按总市值降序。
 * 原样按东财排名展示（不做剔除过滤，杠杆产品也会上榜，与东财官方口径一致）。
 */

import type { UsMarketNumber, UsTopStock } from '../types/quote'
import { formatNumber } from './formatter'

/** 东财 clist/get 响应原始结构（只声明用到的字段） */
export interface EastmoneyClistBody {
  rc?: number
  data?: {
    total?: number
    diff?: Array<Record<string, unknown>>
  }
}

/**
 * 数值字段归一：东财对停牌/无数据返回字符串 "-"，统一归一为 null；
 * 数字且有限时原样返回。
 */
function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/** 市场号合法性（105/106/107），非法市场不产出 secid */
function marketOf(value: unknown): UsMarketNumber | null {
  return value === 105 || value === 106 || value === 107 ? (value as UsMarketNumber) : null
}

/**
 * 解析 clist/get 响应为美股TOP100列表（按东财返回顺序，即市值降序）。
 * 跳过缺代码 / 市场号非美股三大市场的行（如数据异常），不做市值过滤。
 */
export function parseUsTop100(body: EastmoneyClistBody | null | undefined): UsTopStock[] {
  const rows = body?.data?.diff ?? []
  const items: UsTopStock[] = []
  for (const row of rows) {
    const code = typeof row['f12'] === 'string' ? row['f12'] : ''
    const market = marketOf(row['f13'])
    if (!code || !market) continue
    items.push({
      code,
      market,
      secid: `${market}.${code}`,
      name: typeof row['f14'] === 'string' && row['f14'] ? row['f14'] : code,
      price: num(row['f2']),
      pct: num(row['f3']),
      change: num(row['f4']),
      marketCap: num(row['f20']),
    })
  }
  return items
}

/**
 * 总市值展示（美元口径，东财 f20 对美股返回美元）：
 * - ≥ 1万亿 → $x.xx万亿（如 $5.05万亿）
 * - ≥ 1亿 → $x亿（四舍五入取整，如 $9476亿）
 * - ≥ 1万 → $x万
 * - 其余 → $x（原值）
 * 无数据返回 '--'。
 */
export function formatUsMarketCap(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '--'
  if (value >= 1e12) return `$${formatNumber(value / 1e12)}万亿`
  if (value >= 1e8) return `$${formatNumber(value / 1e8, 0)}亿`
  if (value >= 1e4) return `$${formatNumber(value / 1e4, 0)}万`
  return `$${formatNumber(value, 0)}`
}
