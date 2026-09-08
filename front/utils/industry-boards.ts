/**
 * A股全部行业板块 解析与排序过滤（纯函数，供 api/industry-boards.ts 与页面使用）。
 *
 * 数据源：东财延迟行情 clist/get（push2delay.eastmoney.com，与首页行情同域），
 * fs=m:90+t:2+f:!50 为东财「行业板块」清单（496 项，含申万一级~三级细分，
 * 如 石油石化 BK0464 / 农林牧渔 BK0433 / 钢铁 BK0479 / 影视院线 BK1222 / 地面兵装Ⅱ BK1229 等）。
 */

/** A股行业板块条目（名称 + 当日涨跌幅，无价格） */
export interface IndustryBoardRow {
  /** 东财行业板块代码（BKxxxx） */
  code: string
  name: string
  /** 当日涨跌幅（%），无数据为 null */
  pct: number | null
}

/** 东财 clist/get 响应原始结构（只声明用到的字段） */
export interface EastmoneyBoardListBody {
  rc?: number
  data?: {
    total?: number
    diff?: Array<Record<string, unknown>>
  }
}

/** 数值归一：东财对无数据返回 "-"，统一为 null；数字且有限原样返回 */
function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/**
 * 解析 clist/get 单页响应为行业板块行。
 * 跳过缺代码 / 非 BK 板块 / 缺名称的行（数据异常防护）。
 */
export function parseIndustryBoardRows(
  body: EastmoneyBoardListBody | null | undefined,
): IndustryBoardRow[] {
  const rows = body?.data?.diff ?? []
  const items: IndustryBoardRow[] = []
  for (const row of rows) {
    const code = typeof row['f12'] === 'string' ? row['f12'] : ''
    const name = typeof row['f14'] === 'string' && row['f14'] ? row['f14'] : ''
    if (!code || !code.startsWith('BK') || !name) continue
    items.push({ code, name, pct: num(row['f3']) })
  }
  return items
}

/** 涨跌幅排序方向 */
export type PctSortDir = 'asc' | 'desc'

/**
 * 按涨跌幅排序（内存排序，不重新请求）：
 * - desc = 领涨在前 / asc = 领跌在前；
 * - 无数据（null，显示 --）的行始终排在最后（无论方向），保证有效行不被 null 打断。
 * 返回新数组，不修改入参；同名按代码升序兜底保证稳定。
 */
export function sortIndustryRows(rows: IndustryBoardRow[], dir: PctSortDir): IndustryBoardRow[] {
  return [...rows].sort((a, b) => {
    if (a.pct === null && b.pct === null) return a.code < b.code ? -1 : 1
    if (a.pct === null) return 1
    if (b.pct === null) return -1
    const delta = dir === 'desc' ? b.pct - a.pct : a.pct - b.pct
    if (delta !== 0) return delta
    return a.code < b.code ? -1 : 1
  })
}

/**
 * 名称模糊过滤（大小写不敏感；空白 / 空查询返回全量）。
 * 支持按 代码 后 5 位（BKxxxx → xxxx）也能命中，方便用户输数字定位。
 */
export function filterIndustryRows(rows: IndustryBoardRow[], query: string): IndustryBoardRow[] {
  const q = (query ?? '').trim().toLowerCase()
  if (!q) return rows
  return rows.filter((row) => {
    if (row.name.toLowerCase().includes(q)) return true
    const shortCode = row.code.replace(/^BK/i, '').toLowerCase()
    return shortCode.includes(q) || row.code.toLowerCase().includes(q)
  })
}
