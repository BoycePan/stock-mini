import type {
  AnnouncementItem,
  AnnouncementListResponse,
  NewsItem,
  NewsListResponse,
} from '../types/stock'
import { unwrapAnnouncementItems, unwrapNewsItems } from '../utils/api-normalizers'
import { request } from './client'

export const newsApi = {
  async getFeed(limit = 20) {
    const response = await request<NewsListResponse>({
      path: '/api/v1/news/feed',
      query: { count: limit },
    })
    return unwrapNewsItems(response)
  },
  async getStockNews(code: string, page = 1) {
    const response = await request<NewsListResponse>({
      path: `/api/v1/stock/${code}/news`,
      query: { page },
    })
    return unwrapNewsItems(response)
  },
  async getAnnouncements(code: string, page = 1) {
    const response = await request<AnnouncementListResponse>({
      path: `/api/v1/stock/${code}/announcements`,
      query: { page },
    })
    return unwrapAnnouncementItems(response)
  },
}

export type { AnnouncementItem, NewsItem }
