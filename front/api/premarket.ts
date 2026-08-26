/**
 * 美股盘前行情 Demo 取数（纯前端，临时演示用）。
 *
 * 数据源：东方财富 ulist.np/get（push2delay，与仓库既有外部行情同 host，避免新增合法域名）。
 * 盘前时段（美东 04:00–09:30）东财 f2 为盘前价、f3 为相对昨收的盘前涨跌幅；
 * 非盘前时段展示美股当前最新报价（盘中 / 盘后），盘后/休市展示最近收盘口径。
 * 本模块只改造前端，不触碰 backend-java/（符合 AGENTS.md）。
 */

import { requestExternal } from './external'
import { parseEastmoneyUlistQuote, type EastmoneyUlistQuoteRaw } from '../utils/quote-parser'
import { getUsPhase, type UsPhase } from '../utils/market-clock'
import { formatNumber } from '../utils/formatter'
import type { MarketMetric, MarketSection } from '../types/market'
import { PREMARKET_INDICES, PREMARKET_STOCKS, type PremarketItem } from '../config/premarket'

const HOST = 'https://push2delay.eastmoney.com'

/**
 * 美股盘前（或当前阶段）行情页数据。
 * statusTone 采用 market-clock 的三态 tone 语义：active=盘中 / quiet=盘前盘后 / rest=休市，
 * 供页面顶部状态胶囊着色。
 */
export interface PremarketPageData {
  statusLabel: string
  statusTone: 'active' | 'quiet' | 'rest'
  updatedLabel: string
  sections: MarketSection[]
}

/** 单条盘前/当前报价 */
interface PremarketQuote {
  price: number | null
  pct: number | null
  name: string
}

/** 各区交易阶段对应的盘面状态（文案 + 色调，与 market-clock 一致的 tone 语义） */
const PHASE_META: Record<UsPhase, { label: string; tone: 'active' | 'quiet' | 'rest' }> = {
  regular: { label: '美股盘中', tone: 'active' }, // 绿色 = 盘中
  pre: { label: '美股盘前', tone: 'quiet' }, // 蓝色 = 盘前
  post: { label: '美股盘后', tone: 'quiet' }, // 蓝色 = 盘后
  off: { label: '美股休市', tone: 'rest' }, // 灰色 = 休市/周末
}

/**
 * 批量拉取美股报价（ulist.np/get，一次请求全部 secid）。
 * 返回 map：key = `市场号.代码`（如 105.NVDA），value = 该报价；失败返回空 map（调用方按需降级）。
 */
async function fetchQuotes(secids: string[]): Promise<Map<string, PremarketQuote>> {
  if (!secids.length) return new Map()
  const params = [
    'fltt=2',
    'invt=2',
    `secids=${encodeURIComponent(secids.join(','))}`,
    'fields=f2,f3,f12,f13,f14,f18',
  ].join('&')
  const url = `${HOST}/api/qt/ulist.np/get?${params}`
  const map = new Map<string, PremarketQuote>()
  try {
    const body = await requestExternal<{ data?: { diff?: EastmoneyUlistQuoteRaw[] } }>(url, {
      timeout: 10000,
    })
    for (const raw of body?.data?.diff ?? []) {
      const quote = parseEastmoneyUlistQuote('', raw)
      // price 为空 -> 该标的暂无有效报价（如休市未启动），跳过
      if (!quote || quote.price === null) continue
      map.set(`${quote.market}.${quote.code}`, {
        price: quote.price,
        pct: quote.changePercent,
        name: quote.name,
      })
    }
  } catch (error) {
    console.warn('[premarket] 东方财富美股报价失败:', error)
  }
  return map
}

/** 单个配置项 -> 展示指标（raw change 数值，view 字段由页面 metricViewModel 补齐） */
function toMetric(
  item: PremarketItem,
  quote: PremarketQuote | undefined,
  index: number,
): MarketMetric {
  return {
    id: `${item.secid}-${index}`,
    // 统一用配置中的简洁名称（东财返回的 name 过长，如「Meta Platforms Inc-A」），
    // 保证演示卡片文案可控；仅在配置名缺失时回退东财名。
    name: item.name || quote?.name || item.secid,
    value: quote?.price != null ? formatNumber(quote.price, 2) : '',
    change: quote?.pct ?? 0,
    // 无涨跌幅（缺失）时隐藏涨跌徽标，避免展示无意义的 0.00%
    hideChange: quote?.pct == null,
    icon: item.icon,
    minuteCode: item.minuteCode,
  }
}

/**
 * 组装美股盘前（或当前阶段）行情页数据。
 * 返回的 metrics 为 raw（change 为数值），页面层负责 metricViewModel 注入 view 字段。
 */
export async function getPremarketPage(): Promise<PremarketPageData> {
  const all = [...PREMARKET_INDICES, ...PREMARKET_STOCKS]
  const quotes = await fetchQuotes(all.map((item) => item.secid))
  // 全部标的都无有效报价（接口整体失败/休市未启动）时抛错，页面走错误态；部分命中则展示命中项 + 骨架
  if (quotes.size === 0) throw new Error('暂无美股行情数据')

  const sections: MarketSection[] = []
  const indexMetrics = PREMARKET_INDICES.map((item, index) =>
    toMetric(item, quotes.get(item.secid), index),
  )
  if (indexMetrics.length) {
    sections.push({
      id: 'premarket-index',
      title: '美股指数',
      tone: 'global',
      metrics: indexMetrics,
    })
  }
  const stockMetrics = PREMARKET_STOCKS.map((item, index) =>
    toMetric(item, quotes.get(item.secid), index),
  )
  if (stockMetrics.length) {
    sections.push({
      id: 'premarket-stock',
      title: '热门个股',
      tone: 'global',
      tip: '美股盘前行情（美东 04:00–09:30）为盘前撮合价，仅供参考；数据来自公开接口，可能有延迟，不构成投资建议',
      metrics: stockMetrics,
    })
  }
  if (!sections.length) throw new Error('暂无美股行情数据')

  const phase = getUsPhase()
  const meta = PHASE_META[phase]
  return {
    statusLabel: meta.label,
    statusTone: meta.tone,
    // 保持与仓库既有行情页一致的「已更新」文案
    updatedLabel: `已更新 · 数据每60秒刷新一次`,
    sections,
  }
}
