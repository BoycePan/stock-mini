/**
 * 大盘云图数据层：东方财富 push2delay 公开接口直连（与 52etf.site 同源，实测可用）。
 *
 * 架构：两段式加载，避免一次性拉全量 A 股（clist 单页上限 100，全 A 需 56 页）：
 *  - 第一层（行业板块）：GET /api/qt/clist/get?fs=m:90+t:2 → 496 个东财行业板块（5 页并行）
 *  - 第二层（成分股）：钻取板块时 GET /api/qt/clist/get?fs=b:BKxxxx → 该板块成分股
 *  - 顶栏指数：GET /api/qt/ulist.np/get → 上证/深证/创业板/科创50/恒指
 *  - 8s 轮询只刷新「当前层」数据，结构不重建。
 *
 * 所有请求失败降级为空数据（不抛错），页面展示空态/旧数据，绝不让单源故障拖垮页面。
 */

import { requestExternal } from '../../api/external'
import type { BoardStock, IndustryBoard, TreemapIndexQuote, TreemapNode } from '../types/treemap'

const HOST = 'https://push2delay.eastmoney.com'

/** clist 单页上限（实测 pz 再大也只返回 100 条） */
const PAGE_SIZE = 100
/** 行业板块并发拉取页数上限（496 板块 → 5 页） */
const BOARD_PAGE_LIMIT = 6
/** 板块列表结构缓存 5 分钟（与 52etf TREE_STRUCTURE 同思路，避免每次进入都重拉） */
const BOARD_CACHE_TTL = 5 * 60 * 1000

interface ClistRow {
  f2?: number | string | null
  f3?: number | string | null
  f5?: number | string | null
  f6?: number | string | null
  f8?: number | string | null
  f12?: string | number
  f14?: string
  f20?: number | string | null
  f21?: number | string | null
  f104?: number | string | null
  f105?: number | string | null
  f128?: string
  f140?: string | number
}

interface ClistResponse {
  data?: {
    total?: number | string
    diff?: ClistRow[]
  }
}

function toNum(value: number | string | null | undefined): number {
  if (value === null || value === undefined || value === '') return 0
  const n = typeof value === 'number' ? value : Number(String(value).trim())
  return Number.isFinite(n) ? n : 0
}

/** 拉一页 clist；失败返回空数组（不抛错） */
async function fetchClistPage(
  fs: string,
  fields: string,
  pn: number,
  timeout = 15000,
): Promise<ClistRow[]> {
  const params = [
    `pn=${pn}`,
    `pz=${PAGE_SIZE}`,
    'po=1',
    'np=1',
    'ut=fa5fd1943c7b386f172d6893dbfba10b',
    'invt=2',
    'fltt=2',
    'fid=f3',
    `fs=${encodeURIComponent(fs)}`,
    `fields=${encodeURIComponent(fields)}`,
  ].join('&')
  const url = `${HOST}/api/qt/clist/get?${params}`
  try {
    const body = await requestExternal<ClistResponse>(url, { timeout })
    return body?.data?.diff ?? []
  } catch (error) {
    console.warn(`[treemap] clist 分页失败 pn=${pn} fs=${fs}:`, error)
    return []
  }
}

/** 并行拉全量分页（返回合并后的行 + 是否拉满） */
async function fetchClistAll(
  fs: string,
  fields: string,
  maxPages: number,
): Promise<{ rows: ClistRow[]; complete: boolean }> {
  // 先拉第 1 页拿 total，再并行补齐其余页
  const first = await fetchClistPage(fs, fields, 1)
  if (!first.length) return { rows: [], complete: false }
  if (first.length < PAGE_SIZE) return { rows: first, complete: true }

  const remaining = await Promise.all(
    Array.from({ length: maxPages - 1 }, (_, index) => fetchClistPage(fs, fields, index + 2)),
  )
  const rows = [first, ...remaining].flat()
  return { rows, complete: rows.length < PAGE_SIZE * maxPages }
}

// ---------------------------------------------------------------------------
// 顶栏指数
// ---------------------------------------------------------------------------

interface UlistRow {
  f2?: number | string | null
  f3?: number | string | null
  f12?: string | number
  f14?: string
}

/** 指数行情（上证/深证/创业板/科创50/恒指） */
export async function fetchIndexQuotes(): Promise<TreemapIndexQuote[]> {
  const secids = ['1.000001', '0.399001', '0.399006', '1.000688', '100.HSI']
  const names = ['上证指数', '深证成指', '创业板指', '科创50', '恒生指数']
  const params = [
    'fltt=2',
    'invt=2',
    'fields=f2,f3,f12,f14',
    `secids=${encodeURIComponent(secids.join(','))}`,
  ].join('&')
  const url = `${HOST}/api/qt/ulist.np/get?${params}`
  const empty = secids.map((secid, index): TreemapIndexQuote => ({
    code: codeOfSecid(secid),
    name: names[index] ?? '',
    price: null,
    pct: null,
  }))
  try {
    const body = await requestExternal<{ data?: { diff?: UlistRow[] } }>(url, { timeout: 10000 })
    const rows = body?.data?.diff ?? []
    const byCode = new Map(rows.map((row) => [String(row.f12 ?? ''), row]))
    return secids.map((secid, index): TreemapIndexQuote => {
      const row = byCode.get(codeOfSecid(secid)) ?? rows[index]
      const price = toNum(row?.f2)
      const pct = toNum(row?.f3)
      return {
        code: codeOfSecid(secid),
        name: row?.f14 || names[index] || '',
        price: price > 0 ? price : null,
        pct: Number.isFinite(pct) ? pct : null,
      }
    })
  } catch (error) {
    console.warn('[treemap] 指数行情失败:', error)
    return empty
  }
}

/** 从 secid（如 "1.000001" / "100.HSI"）取纯代码（如 "000001" / "HSI"） */
function codeOfSecid(secid: string): string {
  const parts = secid.split('.')
  return parts[1] ?? secid
}

// ---------------------------------------------------------------------------
// 行业板块（第一层）
// ---------------------------------------------------------------------------

const BOARD_FIELDS = 'f2,f3,f6,f12,f14,f20,f104,f105,f128,f140'
/** 东财行业板块（fs=m:90+t:2），带 5 分钟内存缓存 */
let boardCache: { timestamp: number; boards: IndustryBoard[] } | null = null

export async function fetchIndustryBoards(force = false): Promise<IndustryBoard[]> {
  if (!force && boardCache && Date.now() - boardCache.timestamp < BOARD_CACHE_TTL) {
    return boardCache.boards
  }
  const { rows } = await fetchClistAll('m:90+t:2', BOARD_FIELDS, BOARD_PAGE_LIMIT)
  // 东财行业列表本身含重复板块（一级板块与细分板块同 code 出现两次，如 BK1202 房地产、
  // BK0739 工程机械、BK1247 基础建设），按 code 去重保留第一条，避免布局/命中重影
  const seen = new Set<string>()
  const boards: IndustryBoard[] = []
  for (const row of rows) {
    if (!row.f12) continue
    const code = String(row.f12)
    if (seen.has(code)) continue
    seen.add(code)
    boards.push({
      code,
      name: row.f14 ?? '',
      price: toNum(row.f2) > 0 ? toNum(row.f2) : null,
      pct: Number.isFinite(toNum(row.f3)) ? toNum(row.f3) : null,
      totalMv: toNum(row.f20),
      amount: toNum(row.f6),
      upCount: toNum(row.f104),
      downCount: toNum(row.f105),
      leaderName: row.f128 ?? '',
      leaderCode: row.f140 ? String(row.f140) : '',
    })
  }
  boardCache = { timestamp: Date.now(), boards }
  return boards
}

// ---------------------------------------------------------------------------
// 板块成分股（第二层）
// ---------------------------------------------------------------------------

const STOCK_FIELDS = 'f2,f3,f5,f6,f8,f12,f14,f20,f21'

/** 板块成分股（fs=b:BKxxxx+f:!50 排除退市），含市值/换手/成交额 */
export async function fetchBoardStocks(bkCode: string): Promise<BoardStock[]> {
  // 大板块成分股可达 500+（如半导体 BK0917 实测 524 只），拉 6 页（600 条）足够覆盖
  const { rows } = await fetchClistAll(`b:${bkCode}+f:!50`, STOCK_FIELDS, 6)
  return rows
    .filter((row) => row.f12)
    .map((row) => ({
      code: String(row.f12),
      name: row.f14 ?? '',
      price: toNum(row.f2) > 0 ? toNum(row.f2) : null,
      pct: Number.isFinite(toNum(row.f3)) ? toNum(row.f3) : null,
      totalMv: toNum(row.f20),
      floatMv: toNum(row.f21) || toNum(row.f20),
      turnover: Number.isFinite(toNum(row.f8)) ? toNum(row.f8) : null,
      amount: toNum(row.f6) > 0 ? toNum(row.f6) : null,
    }))
}

// ---------------------------------------------------------------------------
// 组装热力图节点
// ---------------------------------------------------------------------------

/** 行业板块 → 热力图节点（面积=总市值，颜色=板块涨跌幅） */
export function boardsToNodes(boards: IndustryBoard[]): TreemapNode[] {
  return boards.map((board) => ({
    id: board.code,
    name: board.name,
    weight: Math.max(board.totalMv, 1),
    pct: board.pct,
    price: board.price,
    sub: board.leaderName ? `领涨 ${board.leaderName}` : undefined,
    raw: board,
  }))
}

/** 成分股 → 热力图节点（面积=流通市值，颜色=个股涨跌幅） */
export function stocksToNodes(stocks: BoardStock[]): TreemapNode[] {
  return stocks.map((stock) => ({
    id: stock.code,
    name: stock.name,
    weight: Math.max(stock.floatMv, 1),
    pct: stock.pct,
    price: stock.price,
    sub: stock.code,
    raw: stock,
  }))
}

/** 统计节点集合的涨跌家数与成交额 */
export function summarizeNodes(nodes: TreemapNode[]): {
  up: number
  down: number
  flat: number
  amount: number
} {
  let up = 0
  let down = 0
  let flat = 0
  let amount = 0
  for (const node of nodes) {
    const pct = node.pct
    if (pct === null || pct === undefined) {
      flat += 1
    } else if (pct > 0.000001) {
      up += 1
    } else if (pct < -0.000001) {
      down += 1
    } else {
      flat += 1
    }
    const raw = node.raw as BoardStock | IndustryBoard | undefined
    const amt = raw && 'amount' in raw && typeof raw.amount === 'number' ? raw.amount : 0
    if (amt) amount += amt
  }
  return { up, down, flat, amount }
}
