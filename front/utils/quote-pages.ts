/**
 * 外部行情数据 → 页面展示模型（MarketPageData）的构建器。
 *
 * 三个行情页共用 section-card 渲染，这里把外部接口返回的报价列表
 * 组装成 MarketMetric 结构（name / value=价格 / change=涨跌幅）。
 */

import type { MarketMetric, MarketPageData, MarketSection } from '../types/market'
import { formatNumber } from './formatter'

/** 页面行情条目（外部数据归一化后的展示单元） */
export interface QuoteItem {
  code: string
  name: string
  price: number | null
  /** 涨跌幅（%） */
  pct: number | null
  unit?: string
  icon?: string
}

export interface QuoteGroup {
  id: string
  title: string
  items: QuoteItem[]
}

function metricOf(item: QuoteItem, index: number): MarketMetric {
  return {
    id: `q-${item.code}-${index}`,
    name: item.name,
    value: item.price === null ? '' : formatNumber(item.price),
    change: item.pct ?? 0,
    unit: item.unit,
    icon: item.icon,
  }
}

function sectionOf(group: QuoteGroup, offset: number, tone: MarketSection['tone']): MarketSection {
  return {
    id: group.id,
    title: group.title,
    tone,
    metrics: group.items.map((item, index) => metricOf(item, offset + index)),
  }
}

// ---------------------------------------------------------------------------
// 全球页：全球指数 + 宏观经济 + 行业板块
// ---------------------------------------------------------------------------

export interface QuoteGlobalPageParams {
  indices: QuoteItem[]
  macro: QuoteItem[]
  sectors: QuoteItem[]
  statusLabel: string
  statusTone: 'active' | 'rest'
  /** 板块数据源会话徽标（如 A股时段 / 美股时段） */
  sectorBadge?: string
}

export function buildQuoteGlobalPage(params: QuoteGlobalPageParams): MarketPageData {
  const groups: QuoteGroup[] = []
  if (params.indices.length) {
    groups.push({ id: 'global-index', title: '全球指数', items: params.indices })
  }
  if (params.macro.length) {
    groups.push({ id: 'global-economy', title: '宏观经济', items: params.macro })
  }
  if (params.sectors.length) {
    groups.push({ id: 'industry-board', title: '行业板块', items: params.sectors })
  }

  const sections: MarketSection[] = []
  let offset = 0
  for (const group of groups) {
    const section = sectionOf(group, offset, 'global')
    if (group.id === 'industry-board' && params.sectorBadge) {
      section.badge = params.sectorBadge
    }
    sections.push(section)
    offset += group.items.length
  }

  return {
    statusLabel: params.statusLabel,
    statusTone: params.statusTone,
    updatedLabel: '已更新 · 数据来源：腾讯/新浪/东方财富',
    sections,
  }
}

// ---------------------------------------------------------------------------
// 日韩页：指数组 + 个股组 + 汇率
// ---------------------------------------------------------------------------

export interface QuoteAsiaPageParams {
  indexGroups: QuoteGroup[]
  stockGroups: QuoteGroup[]
  rates: QuoteItem[]
  statusTone: 'active' | 'rest'
}

export function buildQuoteAsiaPage(params: QuoteAsiaPageParams): MarketPageData {
  const sections: MarketSection[] = []
  let offset = 0
  for (const group of [...params.indexGroups, ...params.stockGroups]) {
    sections.push(sectionOf(group, offset, 'asia'))
    offset += group.items.length
  }
  if (params.rates.length) {
    sections.push(sectionOf({ id: 'asia-fx', title: '汇率', items: params.rates }, offset, 'asia'))
  }

  return {
    statusLabel: '亚太',
    statusTone: params.statusTone,
    updatedLabel: '已更新 · 数据来源：腾讯/新浪/东方财富',
    sections,
  }
}

// ---------------------------------------------------------------------------
// 有色页：金银 / 工业金属 / 其他金属
// ---------------------------------------------------------------------------

export interface QuoteMetalsPageParams {
  groups: QuoteGroup[]
  statusTone: 'active' | 'rest'
  /** 内外盘徽标（如 国内盘 / 外盘） */
  badge?: string
}

export function buildQuoteMetalsPage(params: QuoteMetalsPageParams): MarketPageData {
  const sections: MarketSection[] = []
  let offset = 0
  for (const group of params.groups) {
    const section = sectionOf(group, offset, 'metals')
    if (params.badge && offset === 0) {
      section.badge = params.badge
    }
    sections.push(section)
    offset += group.items.length
  }

  return {
    statusLabel: '有色',
    statusTone: params.statusTone,
    updatedLabel: '已更新 · 数据来源：腾讯/新浪/东方财富',
    sections,
  }
}

/** 一组条目是否含有有效报价（用于 statusTone 判定） */
export function hasLiveQuote(items: QuoteItem[]): boolean {
  return items.some((item) => item.price !== null)
}
