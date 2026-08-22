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
   * 该接口需要登录鉴权：请求必须携带 Authorization，且不走 skipLoginWait 逃生口。
   * 配套后端：/api/v1/news/feed 需纳入鉴权拦截范围（见 backend-java WebConfig，当前仅拦 /api/v1/user/**）。
   */
  async getFeed(page = 1, size = 20) {
    const response = await request<NewsListResponse>({
      path: '/api/v1/news/feed',
      query: { page, size },
      withAuth: true,
    })
    return unwrapNewsItems(response)
  },
  /**
   * 通用新闻 feed 分页接口（返回条目 + 是否还有下一页）。
   * 后端 /api/v1/news/feed 会多取一条并返回真实 hasMore，滚动加载用它判断是否继续，
   * 避免「最后一页恰好等于页大小」时多做一次空请求。
   * 仅滚动加载传 id（第一页第一条的 id，后端用作游标分页去重）；刷新 / 首屏走 getFeed 不传。
   */
  async getFeedPage(page = 1, size = 20, options?: { id?: string | number }) {
    const response = await request<NewsListResponse>({
      path: '/api/v1/news/feed',
      query: { page, size, id: options?.id },
      withAuth: true,
    })
    if (Array.isArray(response)) {
      return { items: response, hasMore: response.length >= size }
    }
    return {
      items: response.news,
      hasMore: response.hasMore ?? response.news.length >= size,
    }
  },

  /**
   * 单条新闻明细（按 id 拉取）。
   * 同样需要登录鉴权（携带 Authorization）。
   * 仅「从分享外部直接进入详情页」（URL 带 id）时调用；列表进入走本地缓存，不请求。
   * 注意：后端 NewsController 目前没有 /api/v1/news/{id} 端点，该请求会失败并走详情页降级逻辑。
   */
  async getById(id: string | number) {
    return request<NewsItem>({
      path: `/api/v1/news/${id}`,
      withAuth: true,
    })
  },
  async getStockNews(code: string, page = 1) {
    const response = await request<NewsListResponse>({
      path: `/api/v1/stock/${code}/news`,
      query: { page },
      withAuth: true,
    })
    return unwrapNewsItems(response)
  },
  async getAnnouncements(code: string, page = 1, size = 20) {
    const response = await request<AnnouncementListResponse>({
      path: `/api/v1/stock/${code}/announcements`,
      query: { page, size },
      withAuth: true,
    })
    return unwrapAnnouncementItems(response)
  },
}

export type { AnnouncementItem, NewsItem }
