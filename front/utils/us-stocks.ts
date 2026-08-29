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

/** 列表排序键：cap=总市值 / pct=涨跌幅 */
export type UsSortKey = 'cap' | 'pct'

/** 排序方向 */
export type UsSortDir = 'asc' | 'desc'

/**
 * 美股市值TOP100 排序（纯前端内存排序，不重新请求）：
 * - cap：按总市值（美元）排序；
 * - pct：按涨跌幅排序；
 * - 无数据（null）行（如杠杆产品 "--"）始终排到最后，无论方向，保证有效行不被打断。
 * 返回新数组，不修改入参。
 */
export function sortUsStocks(items: UsTopStock[], key: UsSortKey, dir: UsSortDir): UsTopStock[] {
  const value = (item: UsTopStock): number | null => (key === 'cap' ? item.marketCap : item.pct)
  return [...items].sort((a, b) => {
    const av = value(a)
    const bv = value(b)
    if (av === null && bv === null) return 0
    if (av === null) return 1
    if (bv === null) return -1
    return dir === 'desc' ? bv - av : av - bv
  })
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

// ---------------------------------------------------------------------------
// 公司 logo（纯前端外链图片，docs/frontend-data-sources.md §7）
// ---------------------------------------------------------------------------

/**
 * 公司 logo 外链源：financialmodelingprep.com 的公开图片 CDN（免费、无需 Key），
 * 按裸代码取图，URL 形如 .../image-stock/{SYMBOL}.png（透明底 PNG）。
 * 2026-08-29 实测：覆盖东财美股 TOP100 全部裸代码（含 SPCX/SKHY 等新条目），
 * 仅 BRK_A/BRK_B 与 FMP 符号不一致，走别名映射。
 * 注意：该域名需加入小程序后台「downloadFile 合法域名」才能在生产环境加载。
 */
export const US_LOGO_BASE_URL = 'https://financialmodelingprep.com/image-stock'

/** 个别代码与 FMP 图片符号不一致的别名映射（逐条实测验证） */
const US_LOGO_SYMBOL_ALIASES: Record<string, string> = {
  BRK_A: 'BRK.A',
  BRK_B: 'BRK-B',
}

/** 构建公司 logo 图片地址；无别名时原样使用裸代码 */
export function usLogoUrl(code: string): string {
  const symbol = US_LOGO_SYMBOL_ALIASES[code] ?? code
  return `${US_LOGO_BASE_URL}/${encodeURIComponent(symbol)}.png`
}

/** logo 底片色调：auto=随主题 / light=固定浅色底 / dark=固定深色底 */
export type UsLogoChipTone = 'auto' | 'light' | 'dark'

/**
 * 白色系 logo（透明底白图，浅色底片上不可见）→ 需固定深色底片。
 * 该清单按 2026-08-29 financialmodelingprep.com 实际图片逐张校验
 * （近白像素占比 >50% 判定），若上游换图需重新核对。
 */
const US_WHITE_LOGO_CODES: ReadonlySet<string> = new Set([
  'AAPL',
  'ABBV',
  'ADI',
  'AMZN',
  'ANET',
  'ASML',
  'BLK',
  'BRK_A',
  'CAT',
  'DIS',
  'GEV',
  'GILD',
  'IBM',
  'IFED',
  'KOF',
  'LRCX',
  'MLPR',
  'MRVL',
  'UNH',
  'V',
  'WELL',
])

/** 深色系 logo（深色底片上不可见）→ 需固定浅色底片（判定同上） */
const US_DARK_LOGO_CODES: ReadonlySet<string> = new Set([
  'C',
  'GS',
  'INTC',
  'LIN',
  'MRK',
  'NFLX',
  'NVO',
  'PLTR',
  'SAN',
  'SCCO',
  'SNDK',
  'SPCX',
  'TXN',
  'VZ',
])

/** 返回该股票 logo 的底片色调：白图→dark、深图→light、其余→auto（随主题） */
export function usLogoChipTone(code: string): UsLogoChipTone {
  if (US_WHITE_LOGO_CODES.has(code)) return 'dark'
  if (US_DARK_LOGO_CODES.has(code)) return 'light'
  return 'auto'
}
