import type {
  AnnouncementItem,
  AnnouncementListResponse,
  NewsItem,
  NewsListResponse,
} from '../types/stock'
import { unwrapAnnouncementItems, unwrapNewsItems } from '../utils/api-normalizers'
import { request } from './client'

export const newsApi = {
  async getFeed(page = 1, size = 20) {
    const response = await request<NewsListResponse>({
      path: '/api/v1/news/feed',
      query: { page, size },
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
  async getAnnouncements(code: string, page = 1, size = 20) {
    const response = await request<AnnouncementListResponse>({
      path: `/api/v1/stock/${code}/announcements`,
      query: { page, size },
    })
    return unwrapAnnouncementItems(response)
  },
}

export type { AnnouncementItem, NewsItem }
