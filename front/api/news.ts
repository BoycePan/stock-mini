import type {
  AnnouncementItem,
  AnnouncementListResponse,
  NewsItem,
  NewsListResponse,
} from '../types/stock'
import { unwrapAnnouncementItems, unwrapNewsItems } from '../utils/api-normalizers'
import { request } from './client'

export const newsApi = {
  /**
   * 通用新闻 feed（财经页 / 新闻页共用）。
   * 该接口是公开数据：后端 /api/v1/news/feed 不在鉴权拦截范围（仅 /api/v1/user/** 拦截），
   * 请求也不带 Authorization。skipLoginWait = true 时跳过请求层的登录门闩，
   * 用于无需登录即可展示的页面（当前仅财经页，见 api/market.ts getFinanceMarketPage）。
   */
  async getFeed(page = 1, size = 20, options?: { skipLoginWait?: boolean }) {
    const response = await request<NewsListResponse>({
      path: '/api/v1/news/feed',
      query: { page, size },
      skipLoginWait: options?.skipLoginWait,
    })
    return unwrapNewsItems(response)
  },
  /**
   * 通用新闻 feed 分页接口（返回条目 + 是否还有下一页）。
   * 后端 /api/v1/news/feed 会多取一条并返回真实 hasMore，滚动加载用它判断是否继续，
   * 避免「最后一页恰好等于页大小」时多做一次空请求。
   */
  async getFeedPage(page = 1, size = 20, options?: { skipLoginWait?: boolean }) {
    const response = await request<NewsListResponse>({
      path: '/api/v1/news/feed',
      query: { page, size },
      skipLoginWait: options?.skipLoginWait,
    })
    if (Array.isArray(response)) {
      return { items: response, hasMore: response.length >= size }
    }
    return {
      items: response.news,
      hasMore: response.hasMore ?? response.news.length >= size,
    }
  },

  async getStockNews(code: string, page = 1) {
    const response = await request<NewsListResponse>({
      path: `/api/v1/stock/${code}/news`,
      query: { page },
    })
    return unwrapNewsItems(response)
  },
  async getAnnouncements(code: string, page = 1, size = 20) {
    const response = await request<AnnouncementListResponse>({
      path: `/api/v1/stock/${code}/announcements`,
      query: { page, size },
    })
    return unwrapAnnouncementItems(response)
  },
}

export type { AnnouncementItem, NewsItem }
