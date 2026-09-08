/**
 * 美股精选概念/行业板块 行情取数（纯前端直连国内公开行情，见
 * config/us-board-catalog.ts 头注释与 utils/us-boards.ts）。
 *
 * - 板块清单：config/us-board-catalog.ts 精选目录（概念 27 / 行业 23），无需目录接口；
 * - 板块涨跌幅：成分股等权均值 —— 复用 utils/quote.ts 现成的
 *   fetchUsProxyChangeMap（新浪 gb_ 优先 + 东财 ulist 兜底）/ fetchUsProxyPremarketMap
 *   （新浪 gb_ [22] 盘前参考涨跌幅，仅实时盘前成分）/ averageBoardPcts；
 *   盘前 vs 盘中用 getUsPhase() === 'pre' 判定（与首页板块区 resolveIndustrySource 的
 *   盘前分支同口径：美东 04:00–09:30 且为交易日，DST 自动换算）；
 * - 成分股行（成员弹窗）：东财 ulist（带 f14 中文名）一次批量 + 新浪 gb_ 兜底，pct 口径同上。
 */

import { requestExternal } from './external'
import { getUsPhase, usEtParts } from '../utils/market-clock'
import {
  usBoardByCode,
  usBoardProxiesOf,
  usBoardsOf,
  type UsBoardKind,
} from '../config/us-board-catalog'
import { averageBoardPcts, fetchUsProxyChangeMap, fetchUsProxyPremarketMap } from '../utils/quote'
import {
  isAbnormalPct,
  parseSinaPremarketTime,
  sinaGbPremarketFields,
  sinaGbProxyPct,
} from '../utils/quote-parser'
import { fetchSinaQuotes } from './quote'
import type { UsBoardRow, UsMemberRow } from '../utils/us-boards'

const HOSTS = {
  /** 东财延迟行情（与首页行情同域 push2delay，已在小程序合法域名内） */
  eastmoney: 'https://push2delay.eastmoney.com',
} as const

/** 东财 ulist 成分股批量请求字段：f12 代码 / f13 市场 / f14 名称 / f2 最新价 / f3 涨跌幅 */
const EM_MEMBER_FIELDS = 'f12,f13,f14,f2,f3'

interface EastmoneyMemberRaw {
  f12?: string | number
  f13?: string | number
  f14?: string | number
  f3?: number | string
}

/** 单次东财 ulist 批量行情（成分股中文名 + 涨跌幅；fltt=2 十进制；请求失败降级为空 map） */
async function fetchEastmoneyMemberMap(
  secids: string[],
): Promise<Record<string, { name: string; pct: number | null }>> {
  const result: Record<string, { name: string; pct: number | null }> = {}
  if (!secids.length) return result
  const params = [
    'ut=fa5fd1943c7b386f172d6893dbfba10b',
    'invt=2',
    'fltt=2',
    `secids=${encodeURIComponent(secids.join(','))}`,
    `fields=${EM_MEMBER_FIELDS}`,
  ].join('&')
  const url = `${HOSTS.eastmoney}/api/qt/ulist.np/get?${params}`
  try {
    const body = await requestExternal<{ data?: { diff?: EastmoneyMemberRaw[] } }>(url, {
      timeout: 10000,
    })
    for (const item of body?.data?.diff ?? []) {
      const code = typeof item.f12 === 'string' ? item.f12 : String(item.f12 ?? '')
      const market = typeof item.f13 === 'string' ? item.f13 : String(item.f13 ?? '')
      if (!code || !market) continue
      const name = typeof item.f14 === 'string' && item.f14 ? item.f14 : ''
      const pct = typeof item.f3 === 'number' && Number.isFinite(item.f3) ? item.f3 : null
      result[`${market}.${code}`] = { name, pct }
    }
  } catch (error) {
    console.warn('[us-board-quotes] 东财成分股行情失败:', error)
  }
  return result
}

/**
 * 拉取指定分类（concept / industry）美股板块列表（板块 = 目录行 + 成分等权涨跌幅）。
 * 盘前时段取新浪盘前参考涨跌幅（仅实时盘前成分）；其余走「新浪现价涨跌幅 + 东财兜底」。
 * 请求失败降级为空数组（由页面展示错误 + 重试）。
 */
export async function fetchUsBoardRows(kind: UsBoardKind): Promise<UsBoardRow[]> {
  const proxies = usBoardProxiesOf(kind)
  if (!proxies.length) return []
  const isPremarket = getUsPhase() === 'pre'
  const changeMap = isPremarket
    ? await fetchUsProxyPremarketMap(proxies)
    : await fetchUsProxyChangeMap(proxies)

  const rows: UsBoardRow[] = []
  for (const board of usBoardsOf(kind)) {
    rows.push({
      code: board.code,
      name: board.name,
      pct: averageBoardPcts(board.proxies, changeMap),
      proxies: board.proxies,
    })
  }
  return rows
}

/**
 * 拉取某美股板块（按 code 还原目录）的成分股实时行情（成员弹窗用）。
 * - 盘前：仅返回「有实时盘前数据」的成分（新浪 gb_ [22] 盘前涨跌幅，与板块行口径一致），
 *   无实时盘前数据的成分 pct 置 null（页面 -- 排后）；
 * - 盘中/盘后/休市：东财 ulist 涨跌幅优先、新浪 gb_ 现价涨跌幅兜底；
 * - 中文名统一取东财 ulist f14（缺失回退裸代码）；未排序，由页面按涨跌幅排序。
 */
export async function fetchUsBoardMembers(boardCode: string): Promise<UsMemberRow[]> {
  const board = usBoardByCode(boardCode)
  if (!board) return []
  const isPremarket = getUsPhase() === 'pre'
  const proxies = board.proxies
  const rows: UsMemberRow[] = []

  // ① 东财 ulist 批量：中文名（盘中/盘前均可用）+ 盘中的权威涨跌幅
  const emMap = await fetchEastmoneyMemberMap(proxies)

  // ② 新浪 gb_ 批量：盘前 [21]-[24] 或盘中 [2] 的涨跌幅兜底
  const sinaKeys = proxies.map((proxy) => {
    const dot = proxy.indexOf('.')
    return `gb_${(dot >= 0 ? proxy.slice(dot + 1) : proxy).toLowerCase()}`
  })
  const sinaRows = await fetchSinaQuotes(sinaKeys)

  const etNow = usEtParts()
  proxies.forEach((proxy, index) => {
    const dot = proxy.indexOf('.')
    const ticker = dot >= 0 ? proxy.slice(dot + 1) : proxy
    const emInfo = emMap[proxy]
    const sinaFields = sinaRows[index]?.fields ?? []

    let pct: number | null = null
    if (isPremarket) {
      // 盘前口径：仅取「实时盘前」成分（盘前价有效 + 盘前时间为美东当天）
      const pre = sinaGbPremarketFields(sinaFields)
      const timeInfo = parseSinaPremarketTime(pre.time, etNow)
      if (pre.price != null && pre.price !== 0 && timeInfo?.isToday === true && pre.pct !== null) {
        if (!isAbnormalPct(pre.pct)) pct = pre.pct
      }
    } else if (emInfo && emInfo.pct !== null) {
      pct = emInfo.pct
    } else {
      const fallback = sinaGbProxyPct(sinaFields)
      if (fallback !== null) pct = fallback
    }

    const emName = emInfo?.name?.trim() ?? ''
    rows.push({ code: ticker, mcode: proxy, name: emName || ticker, pct })
  })
  return rows
}
