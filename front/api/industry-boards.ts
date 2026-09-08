/**
 * A股全部板块 / 板块成分股 API（行业板块 + 概念板块；纯前端直连东财延迟行情，
 * 见 docs/us-top100-api.md 同款模式）。
 *
 * 与首页行情同域（push2delay.eastmoney.com，已在小程序合法域名内）：
 *   clist/get 分页拉取（每页 pz=100 封顶，分页去重）：
 *   - 行业板块 fs=m:90+t:2+f:!50：496 项，含一级~三级细分（约 5 页）；
 *   - 概念板块 fs=m:90+t:3+f:!50：504 项（约 6 页）；
 *   - 板块成分股 fs=b:BKxxxx：该板块全部 A 股个股（成员列表，页面上行弹窗用）。
 * 涨跌幅 f3；板块无价格字段，成分股弹窗仅按涨跌幅排序展示（点击进个股详情 / 分时）。
 */
import { requestExternal } from './external'
import {
  parseBoardStockRows,
  parseIndustryBoardRows,
  type EastmoneyBoardListBody,
  type IndustryBoardRow,
} from '../utils/industry-boards'

const HOSTS = {
  /** 东财延迟行情（与首页报价同域 push2delay，已在小程序合法域名内） */
  eastmoney: 'https://push2delay.eastmoney.com',
} as const

/** 板块大类：concept = 概念板块 / industry = 行业板块 */
export type BoardKind = 'concept' | 'industry'

/** 各板块清单的东财 fs 过滤：m:90+t:2（行业）/ m:90+t:3（概念），均 f:!50 排除 */
const BOARD_FS: Record<BoardKind, string> = {
  industry: 'm:90+t:2+f:!50',
  concept: 'm:90+t:3+f:!50',
}

/** 单页条数（东财 clist 单页 pz 上限 100） */
const PAGE_SIZE = 100
/** 板块清单分页安全上限（504 ÷ 100 ≈ 6 页，留余量防上游异常返回空转） */
const MAX_PAGES = 8
/** 成分股分页安全上限（成分股量级通常 ≤ 500，个别大板块可能更多，多留余量） */
const MEMBER_MAX_PAGES = 12

function listUrl(fs: string, page: number): string {
  const params = [
    `pn=${page}`,
    `pz=${PAGE_SIZE}`,
    'po=1',
    'np=1',
    'fltt=2',
    'invt=2',
    'fid=f3',
    `fs=${encodeURIComponent(fs)}`,
    'fields=f12,f14,f3',
  ].join('&')
  return `${HOSTS.eastmoney}/api/qt/clist/get?${params}`
}

/**
 * 按东财 fs 过滤分页拉取全量清单（分页去重，单页不足即停）。
 * 请求失败 / 某页失败降级返回已取到的行（空数组由页面展示错误态 + 重试）。
 */
async function fetchRowsByFs(
  fs: string,
  parse: (body: EastmoneyBoardListBody | null | undefined) => IndustryBoardRow[],
  maxPages: number,
  logLabel: string,
): Promise<IndustryBoardRow[]> {
  const rows: IndustryBoardRow[] = []
  const seen = new Set<string>()
  try {
    for (let page = 1; page <= maxPages; page++) {
      const body = await requestExternal<EastmoneyBoardListBody>(listUrl(fs, page), {
        timeout: 10000,
      })
      const pageRows = parse(body)
      for (const row of pageRows) {
        if (seen.has(row.code)) continue
        seen.add(row.code)
        rows.push(row)
      }
      // 单页不足 → 已到尾页
      if (pageRows.length < PAGE_SIZE) break
    }
  } catch (error) {
    // 中断在中间页时保留已取部分；完全失败由页面按空数组展示错误
    console.warn(`[industry-all] ${logLabel}拉取失败:`, error)
  }
  return rows
}

/** 拉取指定板块分类（行业 / 概念）的 A股全部清单 */
export async function fetchAllBoards(kind: BoardKind): Promise<IndustryBoardRow[]> {
  return fetchRowsByFs(BOARD_FS[kind], parseIndustryBoardRows, MAX_PAGES, '板块')
}

/** 拉取某板块（BKxxxx）的全部成分股（A股个股，未排序，由页面按涨跌幅排序） */
export async function fetchBoardMembers(boardCode: string): Promise<IndustryBoardRow[]> {
  if (!/^BK\d+$/i.test(boardCode)) return []
  return fetchRowsByFs(`b:${boardCode}`, parseBoardStockRows, MEMBER_MAX_PAGES, '成分股')
}
