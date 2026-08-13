import type { MarketPageData } from '../types/market'
import { globalApi } from './global'
import { newsApi } from './news'
import { buildAsiaPage, buildGlobalPage, buildMetalsPage } from '../utils/global-market'

export type MarketPageKey = 'global' | 'asia' | 'metals' | 'finance'

/** 数据全部来自后端接口；接口失败或无数据时直接抛错，由页面展示错误态 */
async function getGlobalMarketPage(): Promise<MarketPageData> {
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
}

async function getAsiaMarketPage(): Promise<MarketPageData> {
  const indices = await globalApi.getIndices()
  if (!indices.length) throw new Error('empty')
  return buildAsiaPage(indices)
}

async function getMetalsMarketPage(): Promise<MarketPageData> {
  const assets = await globalApi.getAssets('commodity')
  if (!assets.length) throw new Error('empty')
  return buildMetalsPage(assets)
}

async function getFinanceMarketPage(): Promise<MarketPageData> {
  const news = await newsApi.getFeed(20)
  if (!news.length) throw new Error('empty')
  const newsMetrics = news.map((item, index) => ({
    id: `finance-news-${index}`,
    name: item.title,
    value: '',
    change: 0,
    icon: '📰',
    detail: {
      title: item.title,
      summary: item.summary ?? '',
      url: item.url,
      source: item.source ?? '',
      time: item.time ?? '',
    },
  }))
  return {
    statusLabel: '财经',
    statusTone: 'active',
    updatedLabel: '已更新 · 财经新闻',
    sections: [{ id: 'finance-news', title: '财经新闻', tone: 'finance', metrics: newsMetrics }],
  }
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
      case 'finance':
        return getFinanceMarketPage()
    }
  },
}
