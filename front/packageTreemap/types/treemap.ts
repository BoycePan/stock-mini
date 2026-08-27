/**
 * 大盘云图（热力图）分包类型定义。
 * 数据源：东方财富 push2delay（延迟行情，公开接口，与 52etf.site 同源，实测可用）。
 */

/** 指数行情（顶栏大盘状态条） */
export interface TreemapIndexQuote {
  /** 指数代码，如 000001 / 399001 */
  code: string
  /** 指数名称，如 上证指数 */
  name: string
  /** 最新点位 */
  price: number | null
  /** 涨跌幅（%） */
  pct: number | null
}

/** 行业板块（热力图第一层，东财行业板块 m:90+t:2） */
export interface IndustryBoard {
  /** 东财板块代码，如 BK0475 */
  code: string
  /** 板块名称，如 半导体 */
  name: string
  /** 板块指数最新价 */
  price: number | null
  /** 板块涨跌幅（%） */
  pct: number | null
  /** 板块总市值（元） */
  totalMv: number
  /** 板块成交额（元） */
  amount: number
  /** 板块内上涨家数 */
  upCount: number
  /** 板块内下跌家数 */
  downCount: number
  /** 领涨股名称 */
  leaderName: string
  /** 领涨股代码 */
  leaderCode: string
}

/** 成分股（热力图第二层，钻取后） */
export interface BoardStock {
  /** 6 位股票代码 */
  code: string
  /** 股票名称 */
  name: string
  /** 最新价 */
  price: number | null
  /** 涨跌幅（%） */
  pct: number | null
  /** 总市值（元） */
  totalMv: number
  /** 流通市值（元），热力图面积用 */
  floatMv: number
  /** 换手率（%） */
  turnover: number | null
  /** 成交额（元） */
  amount: number | null
}

/** 热力图节点（布局用，面积 = weight，颜色 = pct） */
export interface TreemapNode {
  /** 唯一 id：板块用 BK 代码，个股用 6 位代码 */
  id: string
  /** 显示名 */
  name: string
  /** 面积权重（市值，元） */
  weight: number
  /** 涨跌幅（%），决定颜色 */
  pct: number | null
  /** 最新价 / 点位（详情提示用） */
  price: number | null
  /** 附加信息：板块层为领涨股名，个股层为代码 */
  sub?: string
  /** 原始对象引用（跳转用） */
  raw?: IndustryBoard | BoardStock
  /** 子节点（板块层点击后进入的个股层） */
  children?: TreemapNode[]
}

/** 热力图整体（顶栏指数 + 当前层节点） */
export interface TreemapData {
  /** 顶栏指数 */
  indices: TreemapIndexQuote[]
  /** 当前展示层节点（行业层：板块；个股层：成分股） */
  nodes: TreemapNode[]
  /** 上涨家数（当前层） */
  upCount: number
  /** 下跌家数（当前层） */
  downCount: number
  /** 平盘家数（当前层，个股层才有） */
  flatCount: number
  /** 当前层成交额合计（元） */
  totalAmount: number
  /** 数据更新时间戳 */
  updatedAt: number
}

/** 当前层级状态 */
export type TreemapLevel = 'industry' | 'stock'
