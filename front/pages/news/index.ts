import { newsApi } from '../../api/news'
import { rootStore } from '../../stores/root.store'
import { saveNewsDetail } from '../../utils/storage'
import { stripHtml, truncateRichHtml } from '../../utils/html'
import type { NewsItem } from '../../types/stock'
import { bindTheme, unbindTheme } from '../../utils/theme'
import { SHARE_IMAGE_URL } from '../../utils/share'

const FEED_PAGE_SIZE = 20
/**
 * 列表最大条数：滚动加载无限追加会让 this.data 与 DOM 持续膨胀（条目常驻原始 HTML 摘要），
 * 超过上限后丢弃最旧条目，保证内存有上界。
 */
const MAX_FEED_ITEMS = 100
/**
 * 条目透传详情页用的原始摘要最大字符数：单条摘要可能是整篇文章 HTML，
 * 列表层先截断（详情页渲染还有 20KB 保护），防长列表累积撑爆内存。
 */
const MAX_RAW_SUMMARY_CHARS = 10_000

/** 列表展示条目：summary 为后端返回的 HTML（已截断），剥离标签后用于两行预览（原始摘要透传详情页） */
type NewsItemView = NewsItem & { summaryText: string; key: string }

function toNewsViewItem(item: NewsItem, index: number): NewsItemView {
  // 摘要先截断再入列表：原始 HTML 只用于跳详情时透传（truncateRichHtml 未超限时原样返回）
  const summary = truncateRichHtml(item.summary ?? '', MAX_RAW_SUMMARY_CHARS)
  return {
    id: item.id,
    title: item.title,
    url: item.url,
    source: item.source,
    time: item.time,
    summary,
    summaryText: stripHtml(summary),
    // 后端部分条目 url 为空，不能用 url 作 wx:key
    key: item.id ?? `news-${index}-${item.time ?? ''}`,
  }
}

Page({
  data: {
    theme: rootStore.settings.theme,
    loading: true,
    items: [] as NewsItemView[],
    error: '',
    code: '',
    title: '财经新闻',
    hasMore: false,
    loadingMore: false,
  },
  async onLoad(options: Record<string, string | undefined>) {
    bindTheme(this)
    this.setData({
      code: options.code || '',
      title: options.code ? `${options.code} 新闻` : '财经新闻',
    })
    await this.loadData(options.code)
  },
  async onPullDownRefresh() {
    try {
      await this.loadData()
    } finally {
      wx.stopPullDownRefresh()
    }
  },
  async loadData(code?: string) {
    this.setData({ loading: true, error: '', loadingMore: false })
    try {
      if (code) {
        const items = await newsApi.getStockNews(code, 1)
        this.setData({
          loading: false,
          error: '',
          items: items.map(toNewsViewItem),
          hasMore: items.length > 0,
        })
      } else {
        const items = await newsApi.getFeed(1, FEED_PAGE_SIZE)
        this.setData({
          loading: false,
          error: '',
          items: items.map(toNewsViewItem),
          hasMore: items.length >= FEED_PAGE_SIZE,
        })
      }
    } catch (error) {
      this.setData({
        loading: false,
        error: error instanceof Error ? error.message : '新闻加载失败',
      })
    }
  },
  /**
   * 滚动到底部 / 点击「加载更多」：向后端请求下一页并追加。
   * - 列表条数达到 MAX_FEED_ITEMS 后不再追加：超过上限时丢弃最旧条目，内存有上界；
   * - 未超上限时用增量 setData（items[N] 下标路径）只传输新增条目，避免整数组序列化。
   */
  async onLoadMore() {
    if (this.data.loadingMore || !this.data.hasMore) return
    // 列表已达显示上限：不再追加，hasMore 置 false 使底部加载态自洽（下拉刷新会重建列表恢复）
    if (this.data.items.length >= MAX_FEED_ITEMS) {
      this.setData({ hasMore: false })
      return
    }
    this.setData({ loadingMore: true })
    try {
      const base = this.data.items.length
      const page = Math.ceil((base + 1) / FEED_PAGE_SIZE)
      let items: NewsItem[]
      let hasMore: boolean
      if (this.data.code) {
        // 个股新闻按页追加
        items = await newsApi.getStockNews(this.data.code, page)
        hasMore = items.length > 0
      } else {
        // 通用 feed 分页追加
        items = await newsApi.getFeed(page, FEED_PAGE_SIZE)
        hasMore = items.length >= FEED_PAGE_SIZE
      }
      const freshView = items.map((item, i) => toNewsViewItem(item, base + i))
      const merged = this.data.items.concat(freshView)
      const patch: Record<string, unknown> = { hasMore }
      if (merged.length > MAX_FEED_ITEMS) {
        // 超上限：整体重建并丢弃最旧条目（新闻越旧价值越低，保留最新）
        patch.items = merged.slice(merged.length - MAX_FEED_ITEMS)
      } else {
        // 未超上限：增量 setData 只传输新增条目的路径
        freshView.forEach((item, i) => {
          patch[`items[${base + i}]`] = item
        })
      }
      this.setData(patch)
    } catch (error) {
      wx.showToast({ title: error instanceof Error ? error.message : '加载失败', icon: 'none' })
    } finally {
      this.setData({ loadingMore: false })
    }
  },
  onRetry() {
    this.loadData()
  },
  onScrollLower() {
    this.onLoadMore()
  },
  onUnload() {
    unbindTheme(this)
  },
  onItemTap(event: WechatMiniprogram.BaseEvent) {
    const index = (event.currentTarget as unknown as { dataset: { index?: number } }).dataset.index
    if (index === undefined) return
    const item = this.data.items[index]
    if (!item) return
    saveNewsDetail({
      // 缓存真实 id：详情页分享时回带到分享路径（接收方按 id 拉取明细）
      id: item.id ? String(item.id) : undefined,
      title: item.title,
      summary: item.summary ?? '',
      url: item.url,
      source: item.source ?? '',
      time: item.time ?? '',
    })
    wx.navigateTo({
      url: `/pages/news-detail/index?title=${encodeURIComponent(item.title)}&url=${encodeURIComponent(item.url)}`,
    })
  },
  onShareAppMessage(): WechatMiniprogram.Page.ICustomShareContent {
    return {
      title: this.data.title || '财经新闻',
      // 个股新闻页透传 code，接收方打开后仍是同一只股票的新闻列表
      path: this.data.code
        ? `/pages/news/index?code=${encodeURIComponent(this.data.code)}`
        : '/pages/news/index',
      imageUrl: SHARE_IMAGE_URL,
    }
  },
})
