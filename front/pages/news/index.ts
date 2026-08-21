import { newsApi } from '../../api/news'
import { rootStore } from '../../stores/root.store'
import { saveNewsDetail } from '../../utils/storage'
import { stripHtml } from '../../utils/html'
import type { NewsItem } from '../../types/stock'
import { bindTheme, unbindTheme } from '../../utils/theme'
import { SHARE_IMAGE_URL } from '../../utils/share'

const FEED_PAGE_SIZE = 20

/** 列表展示条目：summary 为后端返回的 HTML，剥离标签后用于两行预览（原始摘要透传详情页） */
type NewsItemView = NewsItem & { summaryText: string; key: string }

function toNewsViewItem(item: NewsItem, index: number): NewsItemView {
  return {
    ...item,
    summaryText: stripHtml(item.summary ?? ''),
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
  async onLoadMore() {
    if (this.data.loadingMore || !this.data.hasMore) return
    this.setData({ loadingMore: true })
    try {
      if (this.data.code) {
        // 个股新闻按页追加
        const page = Math.ceil((this.data.items.length + 1) / FEED_PAGE_SIZE)
        const items = await newsApi.getStockNews(this.data.code, page)
        this.setData({
          items: [...this.data.items, ...items.map(toNewsViewItem)],
          hasMore: items.length > 0,
        })
      } else {
        // 通用 feed 分页追加
        const page = Math.ceil((this.data.items.length + 1) / FEED_PAGE_SIZE)
        const items = await newsApi.getFeed(page, FEED_PAGE_SIZE)
        this.setData({
          items: [...this.data.items, ...items.map(toNewsViewItem)],
          hasMore: items.length >= FEED_PAGE_SIZE,
        })
      }
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
