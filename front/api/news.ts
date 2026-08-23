import type {
  AnnouncementItem,
  AnnouncementListResponse,
  NewsItem,
  NewsListResponse,
} from '../types/stock'
import { unwrapAnnouncementItems, unwrapNewsItems } from '../utils/api-normalizers'
import { request } from './client'

/**
 * needToPull 时钟偏差容差（毫秒，2 分钟）：
 * 客户端 Date.now() 可能略快于服务端时钟，直接以其为 lastPullTime 时
 * 服务端 UPDATE_TIME（恒 <= 服务端当前时间）将永远不大于它，needToPull 恒返回 false，
 * 财经页「有新新闻」悬浮按钮会静默失效。发送前回拨该容差，偏差在容差内的客户端仍能正常触发；
 * 副作用是每次新闻更新后的容差时长内会多触发少量 getFeed(1,1) 轻量请求（见 needToPull 注释）。
 */
const CLOCK_SKEW_TOLERANCE_MS = 2 * 60 * 1000

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
   * 轻量判断是否需要拉取最新通用新闻（供财经页增量刷新轮询）。
   * 服务端在新闻更新时间 UPDATE_TIME > lastPullTime 时返回 true（data 为 boolean）。
   * @param lastPullTime 客户端上次拉取时间戳（毫秒），默认 0 = 从未拉取（服务端恒返回 true）。
   *   为规避客户端/服务端时钟偏差，发送前会回拨 CLOCK_SKEW_TOLERANCE_MS 容差：
   *   客户端时钟略快于服务端时，直接比较会让 UPDATE_TIME 永远 <= lastPullTime、
   *   needToPull 恒 false，「有新新闻」按钮静默失效；回拨后偏差在容差内的客户端仍能触发。
   *   代价是每次新闻更新后最多多触发容差时长内的少量多余轻量请求（getFeed(1,1)），
   *   与旧实现「每 10s 必拉一页」相比仍可接受。根治方案需后端在响应中返回 UPDATE_TIME
   *   作为比对基准（当前仅返回 boolean，前端无法完全消除时钟依赖）。
   */
  async needToPull(lastPullTime = 0) {
    const baseline = Math.max(0, lastPullTime - CLOCK_SKEW_TOLERANCE_MS)
    const response = await request<boolean>({
      path: '/api/v1/news/needToPull',
      query: { lastPullTime: baseline },
      withAuth: true,
    })
    return Boolean(response)
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
