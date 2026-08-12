import { newsApi } from '../../api/news'
import { stockApi } from '../../api/stock'
import { getTheme, saveNewsDetail, type ThemeMode } from '../../utils/storage'
import type { AnnouncementItem, KlinePoint, NewsItem, StockQuote } from '../../types/stock'
import { formatChange } from '../../utils/formatter'

const ANNOUNCEMENT_PAGE_SIZE = 20

type QuoteView = StockQuote & { changeText: string; changeClass: string }

Page({
  data: {
    theme: getTheme() as ThemeMode,
    code: '',
    loading: true,
    quote: null as QuoteView | null,
    klines: [] as KlinePoint[],
    news: [] as NewsItem[],
    newsPage: 1,
    newsHasMore: false,
    loadingMoreNews: false,
    announcements: [] as AnnouncementItem[],
    announcementPage: 1,
    announcementHasMore: false,
    loadingMoreAnnouncements: false,
    scale: '240',
    error: '',
  },
  async onLoad(options: Record<string, string | undefined>) {
    const code = options.code || ''
    this.setData({ code })
    await this.loadData(code)
  },
  onShow() {
    this.setData({ theme: getTheme() })
  },
  async onPullDownRefresh() {
    try {
      await this.loadData()
    } finally {
      wx.stopPullDownRefresh()
    }
  },
  async loadData(code?: string) {
    const targetCode = code || this.data.code
    if (!targetCode) {
      this.setData({ loading: false, error: '缺少股票代码' })
      return
    }
    this.setData({ loading: true, error: '' })
    try {
      const [quote, klineResult, newsResult, announcementResult] = await Promise.all([
        stockApi.getQuote(targetCode),
        stockApi.getKlines(targetCode, this.data.scale, 30),
        newsApi.getStockNews(targetCode, 1),
        newsApi.getAnnouncements(targetCode, 1),
      ])
      this.setData({
        loading: false,
        quote: {
          ...quote,
          changeText: formatChange(quote.pct_change),
          changeClass: quote.pct_change >= 0 ? 'up' : 'down',
        },
        klines: klineResult.klines,
        news: newsResult,
        newsPage: 1,
        newsHasMore: newsResult.length > 0,
        announcements: announcementResult,
        announcementPage: 1,
        announcementHasMore: announcementResult.length >= ANNOUNCEMENT_PAGE_SIZE,
        loadingMoreNews: false,
        loadingMoreAnnouncements: false,
      })
    } catch (error) {
      this.setData({
        loading: false,
        error: error instanceof Error ? error.message : '数据加载失败',
      })
    }
  },
  async onRefresh() {
    await this.loadData()
  },
  async onScaleChange(event: WechatMiniprogram.BaseEvent) {
    const scale = (event.currentTarget as unknown as { dataset: { value?: string } }).dataset.value
    if (!scale || scale === this.data.scale) return
    this.setData({ scale })
    await this.loadData()
  },
  async onLoadMoreNews() {
    if (this.data.loadingMoreNews || !this.data.newsHasMore) return
    const nextPage = this.data.newsPage + 1
    this.setData({ loadingMoreNews: true })
    try {
      const items = await newsApi.getStockNews(this.data.code, nextPage)
      this.setData({
        news: [...this.data.news, ...items],
        newsPage: nextPage,
        newsHasMore: items.length > 0,
      })
    } catch (error) {
      wx.showToast({ title: error instanceof Error ? error.message : '新闻加载失败', icon: 'none' })
    } finally {
      this.setData({ loadingMoreNews: false })
    }
  },
  async onLoadMoreAnnouncements() {
    if (this.data.loadingMoreAnnouncements || !this.data.announcementHasMore) return
    const nextPage = this.data.announcementPage + 1
    this.setData({ loadingMoreAnnouncements: true })
    try {
      const items = await newsApi.getAnnouncements(this.data.code, nextPage)
      this.setData({
        announcements: [...this.data.announcements, ...items],
        announcementPage: nextPage,
        announcementHasMore: items.length >= ANNOUNCEMENT_PAGE_SIZE,
      })
    } catch (error) {
      wx.showToast({ title: error instanceof Error ? error.message : '公告加载失败', icon: 'none' })
    } finally {
      this.setData({ loadingMoreAnnouncements: false })
    }
  },
  onScrollLower() {
    // 到底后优先加载新闻，新闻加载完再加载公告
    if (this.data.newsHasMore) {
      this.onLoadMoreNews()
    } else if (this.data.announcementHasMore) {
      this.onLoadMoreAnnouncements()
    }
  },
  onNewsTap(event: WechatMiniprogram.BaseEvent) {
    const index = (event.currentTarget as unknown as { dataset: { index?: number } }).dataset.index
    if (index === undefined) return
    const item = this.data.news[index]
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
  onAnnouncementTap(event: WechatMiniprogram.BaseEvent) {
    const url = (event.currentTarget as unknown as { dataset: { url?: string } }).dataset.url
    if (!url) return
    wx.setClipboardData({
      data: url,
      success: () => wx.showToast({ title: '公告链接已复制', icon: 'success' }),
    })
  },
  onShareAppMessage() {
    return { title: this.data.quote?.name || '股票详情' }
  },
})
