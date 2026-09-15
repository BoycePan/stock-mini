/**
 * 美股精选概念/行业板块 —— 纯函数助手与共享类型（无网络依赖，供
 * api/us-board-quotes.ts 取数、industry-all 页美股 Tab 过滤/渲染复用，可单测）。
 *
 * 数据口径：板块涨跌幅 = 成分美股实时涨跌幅等权均值（首页「行业板块」面板美股 Tab 同款口径，
 * 国内源：新浪 hq.sinajs.cn gb_ / 东财 ulist，见 config/us-board-catalog.ts 头注释）。
 */

import type { IndustryBoardRow } from './industry-boards'

/** 美股板块行：目录信息 + 当日涨跌幅（均值，无数据为 null）+ 成分股 secid（成员弹窗用） */
export interface UsBoardRow extends IndustryBoardRow {
  /** 成分股东财 secid（105./106./107. + 代码，见 config/us-board-catalog.ts） */
  proxies: string[]
}

/** 美股板块成分股行（成员弹窗展示用）：代码 = 裸代码，mcode = 东财 secid（跳分时用） */
export interface UsMemberRow {
  /** 成分股裸代码（展示，如 NVDA） */
  code: string
  /** 成分股东财 secid（跳分时用，如 105.NVDA） */
  mcode: string
  /** 成分股中文名（东财 ulist f14，缺省回退代码） */
  name: string
  /** 当日涨跌幅（%），无数据为 null（显示 --） */
  pct: number | null
}

/**
 * 美股板块名称/成分过滤（大小写不敏感；空白 / 空查询返回全量）。
 * - 板块名（如 AI算力 / 减肥药）命中；
 * - 成分股代码命中（输入 NVDA / 英伟达拼音不可用，仅代码：nvda / NVDA 命中 AI算力/半导体）。
 */
export function filterUsBoardRows(rows: UsBoardRow[], query: string): UsBoardRow[] {
  const q = (query ?? '').trim().toLowerCase()
  if (!q) return rows
  return rows.filter((row) => {
    if (row.name.toLowerCase().includes(q)) return true
    if (row.code.toLowerCase().includes(q)) return true
    return row.proxies.some((proxy) => {
      const dot = proxy.indexOf('.')
      const ticker = dot >= 0 ? proxy.slice(dot + 1).toLowerCase() : proxy.toLowerCase()
      return ticker.includes(q)
    })
  })
}

/** 成分股列表按「展示代码」构建展示用代码行（US 成员行 code=mcode 展示裸代码） */
export function usMemberDisplayCode(code: string, mcode: string): string {
  const dot = mcode.indexOf('.')
  return dot >= 0 ? mcode.slice(dot + 1) : code
}
