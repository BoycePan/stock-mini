/**
 * A股全部行业板块 API（纯前端直连东财延迟行情，见 docs/us-top100-api.md 同款模式）。
 *
 * 与首页行情同域（push2delay.eastmoney.com，已在小程序合法域名内）：
 *   clist/get 分页拉取行业板块清单（fs=m:90+t:2+f:!50），每页 pz=100 封顶，
 *   496 项全量约 5 页；涨跌幅 f3，板块无价格字段。
 * 仅展示涨跌幅（板块无价格），点击行不做跳转（东财板块分时源仅在首页精选项登记）。
 */
import { requestExternal } from './external'
import {
  parseIndustryBoardRows,
  type EastmoneyBoardListBody,
  type IndustryBoardRow,
} from '../utils/industry-boards'

const HOSTS = {
  /** 东财延迟行情（与首页报价同域 push2delay，已在小程序合法域名内） */
  eastmoney: 'https://push2delay.eastmoney.com',
} as const

/** 行业板块清单 fs 过滤：m:90+t:2+f:!50（东财「行业板块」，496 项，含一级~三级细分） */
const BOARD_FS = 'm:90+t:2+f:!50'

/** 单页条数（东财 clist 单页 pz 上限 100） */
const PAGE_SIZE = 100
/** 分页安全上限（496 ÷ 100 ≈ 5 页，留余量防上游异常返回空转） */
const MAX_PAGES = 8

function boardUrl(page: number): string {
  const params = [
    `pn=${page}`,
    `pz=${PAGE_SIZE}`,
    'po=1',
    'np=1',
    'fltt=2',
    'invt=2',
    'fid=f3',
    `fs=${encodeURIComponent(BOARD_FS)}`,
    'fields=f12,f14,f3',
  ].join('&')
  return `${HOSTS.eastmoney}/api/qt/clist/get?${params}`
}

/**
 * 拉取 A股全部行业板块（分页去重）。
 * 请求失败 / 某页失败降级返回已取到的行（空数组由页面展示错误态 + 重试）。
 */
export async function fetchAllIndustryBoards(): Promise<IndustryBoardRow[]> {
  const rows: IndustryBoardRow[] = []
  const seen = new Set<string>()
  try {
    for (let page = 1; page <= MAX_PAGES; page++) {
      const body = await requestExternal<EastmoneyBoardListBody>(boardUrl(page), {
        timeout: 10000,
      })
      const pageRows = parseIndustryBoardRows(body)
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
    console.warn('[industry-all] 东财行业板块拉取失败:', error)
  }
  return rows
}
