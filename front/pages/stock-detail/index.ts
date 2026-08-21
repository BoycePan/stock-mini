import { newsApi } from '../../api/news'
import { rootStore } from '../../stores/root.store'
import { stockApi } from '../../api/stock'
import { saveNewsDetail } from '../../utils/storage'
import type { AnnouncementItem, KlinePoint, NewsItem, StockQuote } from '../../types/stock'
import { formatChange, formatNumber, formatWan } from '../../utils/formatter'
import {
  APP_NAME,
  formatShareStamp,
  type PosterData,
  type PosterTone,
} from '../../utils/share-poster'
import { bindTheme, unbindTheme } from '../../utils/theme'
import { buildSharePath, SHARE_IMAGE_URL } from '../../utils/share'

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
    posterData: null as PosterData | null,
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
        posterData: this.buildPosterData(quote),
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
    } catch {
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
  /** 组装分享海报数据（头部 + 行情指标分区；K 线图由 share-poster 组件按 klines 绘制） */
  buildPosterData(quote: StockQuote): PosterData {
    const change = Number(quote.pct_change) || 0
    const tone: PosterTone = change > 0 ? 'up' : change < 0 ? 'down' : 'flat'
    return {
      title: quote.name || '股票详情',
      subtitle: APP_NAME,
      statusText: quote.code || '',
      stamp: formatShareStamp(new Date()),
      includeWatermark: true,
      sections: [
        {
          title: '行情指标',
          rows: [
            {
              name: '最新价',
              value: formatNumber(quote.price, 2),
              changeText: formatChange(change),
              tone,
            },
            { name: '开盘', value: formatNumber(quote.open, 2), changeText: '', tone: 'flat' },
            {
              name: '昨收',
              value: formatNumber(quote.prev_close, 2),
              changeText: '',
              tone: 'flat',
            },
            { name: '最高', value: formatNumber(quote.high, 2), changeText: '', tone: 'flat' },
            { name: '最低', value: formatNumber(quote.low, 2), changeText: '', tone: 'flat' },
            { name: '成交量', value: formatWan(quote.volume), changeText: '', tone: 'flat' },
            { name: '成交额', value: formatWan(quote.amount), changeText: '', tone: 'flat' },
          ],
        },
      ],
    }
  },
  /** 顶栏分享按钮：调起 share-poster 组件生成并预览海报 */
  onSharePoster() {
    const poster = this.selectComponent('#sharePoster') as unknown as { open(): void } | null
    if (poster) poster.open()
  },
  onShareAppMessage() {
    return {
      title: this.data.quote?.name || '股票详情',
      // 分享统一经首页中转：先进入首页，再自动跳转到本页（见 utils/share.ts）
      path: buildSharePath('stock-detail', { code: this.data.code }),
      imageUrl: SHARE_IMAGE_URL,
    }
  },
})
