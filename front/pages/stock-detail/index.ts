import { newsApi } from '../../api/news'
import { rootStore } from '../../stores/root.store'
import { stockApi } from '../../api/stock'
import { saveNewsDetail } from '../../utils/storage'
import type { AnnouncementItem, KlinePoint, NewsItem, StockQuote } from '../../types/stock'
import { formatChange, formatWan } from '../../utils/formatter'
import { bindTheme, unbindTheme } from '../../utils/theme'

const ANNOUNCEMENT_PAGE_SIZE = 20

type QuoteView = StockQuote & {
  changeText: string
  changeClass: string
  volumeText: string
  amountText: string
}

Page({
  data: {
    theme: rootStore.settings.theme,
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
    bindTheme(this)
    const code = options.code || ''
    this.setData({ code })
    await this.loadData(code)
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
          volumeText: formatWan(quote.volume),
          amountText: formatWan(quote.amount),
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
    // 切周期只重拉 K 线，避免连带刷新行情/新闻/公告
    await this.loadKlines(this.data.code, scale)
  },
  async loadKlines(code: string, scale: string) {
    if (!code) return
    try {
      const result = await stockApi.getKlines(code, scale, 30)
      this.setData({ klines: result.klines })
    } catch (error) {
      wx.showToast({ title: 'K线加载失败', icon: 'none' })
    }
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
  onReachBottom() {
    // 新闻与公告各自独立分页，触底时分别加载各自的下一页
    // （各自 onLoadMoreX 内有 loadingMoreX 防重入，滚动连续触发不会重复请求）
    if (this.data.newsHasMore) {
      this.onLoadMoreNews()
    }
    if (this.data.announcementHasMore) {
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
  onUnload() {
    unbindTheme(this)
  },
  onShareAppMessage() {
    return { title: this.data.quote?.name || '股票详情' }
  },
})
