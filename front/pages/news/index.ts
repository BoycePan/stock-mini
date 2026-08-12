import { newsApi } from '../../api/news'
import { rootStore } from '../../stores/root.store'
import { saveNewsDetail } from '../../utils/storage'
import type { NewsItem } from '../../types/stock'
import { bindTheme, unbindTheme } from '../../utils/theme'

const FEED_PAGE_SIZE = 20
const FEED_MAX = 100

Page({
  data: {
    theme: rootStore.settings.theme,
    loading: true,
    items: [] as NewsItem[],
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
          items,
          hasMore: items.length > 0,
        })
      } else {
        const items = await newsApi.getFeed(FEED_PAGE_SIZE)
        this.setData({
          loading: false,
          error: '',
          items,
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
          items: [...this.data.items, ...items],
          hasMore: items.length > 0,
        })
      } else {
        // 通用 feed 不支持分页参数，扩大 count 重新拉取并去重
        const count = Math.min(this.data.items.length + FEED_PAGE_SIZE, FEED_MAX)
        const items = await newsApi.getFeed(count)
        const seen = new Set(this.data.items.map((item) => item.url))
        const appended = items.filter((item) => !seen.has(item.url))
        this.setData({
          items: [...this.data.items, ...appended],
          hasMore: items.length >= count && count < FEED_MAX,
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
})
