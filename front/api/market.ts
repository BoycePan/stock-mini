import { newsApi } from './news'
import { sectorApi } from './sector'
import type { MarketMetric, MarketPageData } from '../types/market'
import { getAsiaMarketMock } from '../mocks/asia-market'
import { getAiMarketMock } from '../mocks/ai-market'
import { getGlobalMarketMock } from '../mocks/global-market'
import { getMetalsMarketMock } from '../mocks/metals-market'

export type MarketPageKey = 'global' | 'asia' | 'metals' | 'ai'

function aiMetric(name: string, index: number, icon: string): MarketMetric {
  return { id: `backend-ai-${index}`, name, value: '', change: 0, icon }
}

async function getAiMarketPage(): Promise<MarketPageData> {
  try {
    const [boards, news] = await Promise.all([sectorApi.getBoards(8), newsApi.getFeed(4)])
    if (boards.length || news.length) {
      const boardMetrics = boards
        .slice(0, 8)
        .map((board, index) => aiMetric(board.plate_name, index, '✦'))
      return {
        statusLabel: 'AI',
        statusTone: 'active',
        updatedLabel: '已更新 · 后端板块/新闻',
        source: 'backend',
        sections: [
          { id: 'ai-backend-concepts', title: '后端热门概念', tone: 'ai', metrics: boardMetrics },
          {
            id: 'ai-news',
            title: 'AI 相关新闻',
            tone: 'ai',
            metrics: news
              .slice(0, 4)
              .map((item, index) => aiMetric(item.title.slice(0, 12), index + 8, '📰')),
          },
        ],
      }
    }
  } catch {
    // 现有后端服务不可用时继续使用 mock，页面仍然可浏览。
  }
  return getAiMarketMock()
}

export const marketApi = {
  async getPage(key: MarketPageKey): Promise<MarketPageData> {
    switch (key) {
      case 'global':
        return getGlobalMarketMock()
      case 'asia':
        return getAsiaMarketMock()
      case 'metals':
        return getMetalsMarketMock()
      case 'ai':
        return getAiMarketPage()
    }
  },
}
