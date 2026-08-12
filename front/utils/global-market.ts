import type { GlobalAsset, GlobalIndex, GlobalSector } from '../types/global'
import type { MarketMetric, MarketPageData, MarketSection } from '../types/market'

type QuoteLike = {
  name: string
  price: number | null
  pctChange: number | null
  updatedAt: string
  isTrading: boolean
}

const marketNames: Record<string, string> = {
  us: '美国',
  cn: '中国',
  hk: '香港',
  tw: '台湾',
  jp: '日本',
  kr: '韩国',
  in: '印度',
  au: '澳洲',
  sg: '新加坡',
  vn: '越南',
  id: '印尼',
  th: '泰国',
  gb: '英国',
  de: '德国',
  fr: '法国',
  eu: '欧元区',
  es: '西班牙',
  nl: '荷兰',
  ca: '加拿大',
  br: '巴西',
  mx: '墨西哥',
}

export function marketName(market: string): string {
  return marketNames[market] ?? market.toUpperCase()
}

/** 与 utils/formatter 同逻辑；此处内联以避免小程序端 .ts 后缀导入问题 */
function formatNumber(value: number, digits = 2): string {
  return Number.isFinite(value) ? value.toFixed(digits) : '--'
}

function quoteMetric(item: QuoteLike, index: number): MarketMetric {
  return {
    id: `global-${index}`,
    name: item.name,
    value: item.price == null ? '' : formatNumber(item.price),
    change: item.pctChange ?? 0,
    updatedAt: item.updatedAt,
  }
}

function anyTrading(items: QuoteLike[]): boolean {
  return items.some((item) => item.isTrading)
}

function pageStatus(
  label: string,
  items: QuoteLike[],
): Pick<MarketPageData, 'statusLabel' | 'statusTone'> {
  return {
    statusLabel: label,
    statusTone: anyTrading(items) ? 'active' : 'rest',
  }
}

/** 全球页：美股指数 + 全球资产 + 美股行业/主题板块 */
export function buildGlobalPage(
  indices: GlobalIndex[],
  sectors: GlobalSector[],
  assets: GlobalAsset[],
): MarketPageData {
  const usIndices = indices.filter((item) => item.market === 'us')
  const industries = sectors.filter((item) => item.board === 'industry')
  const themes = sectors.filter((item) => item.board === 'theme')

  const sections: MarketSection[] = []
  let offset = 0
  if (usIndices.length) {
    sections.push({
      id: 'global-index',
      title: '全球指数',
      tone: 'global',
      metrics: usIndices.map((item, index) => quoteMetric(item, offset + index)),
    })
    offset += usIndices.length
  }
  if (assets.length) {
    sections.push({
      id: 'global-economy',
      title: '全球经济数据',
      tone: 'global',
      metrics: assets.map((item, index) => quoteMetric(item, offset + index)),
    })
    offset += assets.length
  }
  if (industries.length) {
    sections.push({
      id: 'us-industry',
      title: '美股行业',
      tone: 'global',
      metrics: industries.map((item, index) => quoteMetric(item, offset + index)),
    })
    offset += industries.length
  }
  if (themes.length) {
    sections.push({
      id: 'us-theme',
      title: '美股主题',
      tone: 'global',
      metrics: themes.map((item, index) => quoteMetric(item, offset + index)),
    })
  }

  const all = [...usIndices, ...assets, ...industries, ...themes]
  return {
    ...pageStatus('全球', all),
    updatedLabel: '已更新 · 数据每30秒刷新一次',
    sections,
  }
}

/** 亚太页：按市场分组展示亚太指数 */
export function buildAsiaPage(indices: GlobalIndex[]): MarketPageData {
  const asiaMarkets = ['kr', 'jp', 'hk', 'tw', 'cn', 'in', 'au', 'sg', 'vn', 'id', 'th']
  const sections: MarketSection[] = asiaMarkets
    .map((market) => ({ market, items: indices.filter((item) => item.market === market) }))
    .filter((group) => group.items.length > 0)
    .map((group, groupIndex) => ({
      id: `asia-${group.market}`,
      title: `${marketName(group.market)}市场`,
      tone: 'asia',
      metrics: group.items.map((item, index) => quoteMetric(item, groupIndex * 10 + index)),
    }))

  const all = indices.filter((item) => asiaMarkets.includes(item.market))
  return {
    ...pageStatus('亚太', all),
    updatedLabel: '已更新 · 数据每30秒刷新一次',
    sections,
  }
}

/** 金属页：贵金属 / 工业金属 / 能源（按商品 board 分组） */
export function buildMetalsPage(assets: GlobalAsset[]): MarketPageData {
  const groups: Array<{ id: string; title: string; boards: string[] }> = [
    { id: 'precious', title: '贵金属', boards: ['贵金属'] },
    { id: 'industrial', title: '工业金属', boards: ['有色金属', '黑色金属'] },
    { id: 'energy', title: '能源', boards: ['能源'] },
  ]

  const sections: MarketSection[] = []
  let offset = 0
  for (const group of groups) {
    const items = assets.filter((item) => group.boards.includes(item.board))
    if (!items.length) continue
    sections.push({
      id: `metal-${group.id}`,
      title: group.title,
      tone: 'metals',
      metrics: items.map((item, index) => quoteMetric(item, offset + index)),
    })
    offset += items.length
  }

  return {
    ...pageStatus('有色', assets),
    updatedLabel: '已更新 · 数据每30秒刷新一次',
    sections,
  }
}
