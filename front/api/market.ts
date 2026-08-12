import type { MarketPageData } from '../types/market'
import { getMockFallback } from '../utils/storage'
import { getAsiaMarketMock } from '../mocks/asia-market'
import { getAiMarketMock } from '../mocks/ai-market'
import { getGlobalMarketMock } from '../mocks/global-market'
import { getMetalsMarketMock } from '../mocks/metals-market'
import { globalApi } from './global'
import { newsApi } from './news'
import { sectorApi } from './sector'
import { buildAsiaPage, buildGlobalPage, buildMetalsPage } from '../utils/global-market'

export type MarketPageKey = 'global' | 'asia' | 'metals' | 'ai'

/** 后端优先：接口可用则用实时数据；失败/无数据时仅在允许 mock fallback 时回退到 mock */
async function backendFirst(
  load: () => Promise<MarketPageData>,
  fallback: () => MarketPageData,
): Promise<MarketPageData> {
  try {
    return await load()
  } catch (error) {
    if (!getMockFallback()) throw error
    return fallback()
  }
}

async function getGlobalMarketPage(): Promise<MarketPageData> {
  return backendFirst(async () => {
    const [indices, sectors, commodity, forex, bond, crypto] = await Promise.all([
      globalApi.getIndices(),
      globalApi.getSectors('us'),
      globalApi.getAssets('commodity'),
      globalApi.getAssets('forex'),
      globalApi.getAssets('bond'),
      globalApi.getAssets('crypto'),
    ])
    const assets = [...commodity, ...forex, ...bond, ...crypto]
    if (!indices.length && !sectors.length && !assets.length) throw new Error('empty')
    return buildGlobalPage(indices, sectors, assets)
  }, getGlobalMarketMock)
}

async function getAsiaMarketPage(): Promise<MarketPageData> {
  return backendFirst(async () => {
    const indices = await globalApi.getIndices()
    if (!indices.length) throw new Error('empty')
    return buildAsiaPage(indices)
  }, getAsiaMarketMock)
}

async function getMetalsMarketPage(): Promise<MarketPageData> {
  return backendFirst(async () => {
    const assets = await globalApi.getAssets('commodity')
    if (!assets.length) throw new Error('empty')
    return buildMetalsPage(assets)
  }, getMetalsMarketMock)
}

async function getAiMarketPage(): Promise<MarketPageData> {
  return backendFirst(async () => {
    const [boards, news] = await Promise.all([sectorApi.getBoards(8), newsApi.getFeed(4)])
    if (!boards.length && !news.length) throw new Error('empty')
    const boardMetrics = boards.slice(0, 8).map((board, index) => ({
      id: `backend-ai-${index}`,
      name: board.plate_name,
      value: '',
      change: 0,
      icon: '✦',
      source: 'backend' as const,
    }))
    const newsMetrics = news.slice(0, 4).map((item, index) => ({
      id: `backend-ai-news-${index}`,
      name: item.title.slice(0, 12),
      value: '',
      change: 0,
      icon: '📰',
      source: 'backend' as const,
      detail: {
        title: item.title,
        summary: item.summary ?? '',
        url: item.url,
        source: item.source ?? '',
        time: item.time ?? '',
      },
    }))
    return {
      statusLabel: 'AI',
      statusTone: 'active',
      updatedLabel: '已更新 · 后端板块/新闻',
      source: 'backend',
      sections: [
        { id: 'ai-backend-concepts', title: '后端热门概念', tone: 'ai', metrics: boardMetrics },
        { id: 'ai-news', title: 'AI 相关新闻', tone: 'ai', metrics: newsMetrics },
      ],
    }
  }, getAiMarketMock)
}

export const marketApi = {
  async getPage(key: MarketPageKey): Promise<MarketPageData> {
    switch (key) {
      case 'global':
        return getGlobalMarketPage()
      case 'asia':
        return getAsiaMarketPage()
      case 'metals':
        return getMetalsMarketPage()
      case 'ai':
        return getAiMarketPage()
    }
  },
}
