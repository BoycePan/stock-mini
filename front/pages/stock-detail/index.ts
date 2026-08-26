import { newsApi } from '../../api/news'
import { rootStore } from '../../stores/root.store'
import { stockApi } from '../../api/stock'
import { saveNewsDetail } from '../../utils/storage'
import type { AnnouncementItem, KlinePoint, NewsItem, StockQuote } from '../../types/stock'
import { computeChangeView } from '../../utils/market'
import { formatNumber, formatWan } from '../../utils/formatter'
import { truncateRichHtml } from '../../utils/html'
import {
  APP_NAME,
  formatShareStamp,
  type PosterData,
  type PosterTone,
} from '../../utils/share-poster'
import { bindTheme, unbindTheme } from '../../utils/theme'
import { trackEvent } from '../../utils/tracker'
import { buildSharePath, SHARE_IMAGE_URL } from '../../utils/share'

const ANNOUNCEMENT_PAGE_SIZE = 20
/**
 * 新闻 / 公告列表最大条数：滚动加载无限追加会让 this.data 与 DOM 持续膨胀，
 * 超过上限后丢弃最旧条目，保证内存有上界。
 */
const MAX_LIST_ITEMS = 100
/**
 * 新闻条目透传详情页用的原始摘要最大字符数：单条摘要可能是整篇文章 HTML，
 * 列表层先截断（详情页渲染还有 20KB 保护），防长列表累积撑爆内存。
 */
const MAX_RAW_SUMMARY_CHARS = 10_000

type QuoteView = StockQuote & {
  changeText: string
  changeClass: string
  volumeText: string
  amountText: string
}

/** 新闻条目摘要截断到安全上限（truncateRichHtml 未超限时原样返回） */
function capNewsSummary(item: NewsItem): NewsItem {
  return { ...item, summary: truncateRichHtml(item.summary ?? '', MAX_RAW_SUMMARY_CHARS) }
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
    /** 分享原图（wx.showShareImageMenu）的小程序入口路径：与卡片分享一致经首页中转（utils/share.ts） */
    shareEntrancePath: '',
  },
  async onLoad(options: Record<string, string | undefined>) {
    bindTheme(this)
    const code = options.code || ''
    this.setData({
      code,
      // 分享原图的小程序入口：与 onShareAppMessage 卡片分享同一路径（经首页中转），
      // 接收方按 code 还原同一标的，避免默认入口落在「当前页且无参数」导致无法加载；
      // 分享路径统一不带前导斜杠（见 utils/share.ts 的 buildSharePath）
      shareEntrancePath: buildSharePath('stock-detail', { code }),
    })
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
          ...computeChangeView(quote.pct_change),
          volumeText: formatWan(quote.volume),
          amountText: formatWan(quote.amount),
        },
        klines: klineResult.klines,
        posterData: this.buildPosterData(quote),
        news: newsResult.map(capNewsSummary),
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
  /**
   * 新闻列表触底追加：条数达到 MAX_LIST_ITEMS 后不再追加（超过上限时丢弃最旧条目），
   * 未超上限时用增量 setData（news[N] 下标路径）只传输新增条目，避免整数组序列化。
   */
  async onLoadMoreNews() {
    if (this.data.loadingMoreNews || !this.data.newsHasMore) return
    // 列表已达显示上限：不再追加，newsHasMore 置 false 使加载态自洽（下拉刷新会重建列表恢复）
    if (this.data.news.length >= MAX_LIST_ITEMS) {
      this.setData({ newsHasMore: false })
      return
    }
    const nextPage = this.data.newsPage + 1
    this.setData({ loadingMoreNews: true })
    try {
      const items = await newsApi.getStockNews(this.data.code, nextPage)
      const capped = items.map(capNewsSummary)
      const base = this.data.news.length
      const merged = this.data.news.concat(capped)
      const patch: Record<string, unknown> = {
        newsPage: nextPage,
        newsHasMore: items.length > 0,
      }
      if (merged.length > MAX_LIST_ITEMS) {
        // 超上限：整体重建并丢弃最旧条目（新闻越旧价值越低，保留最新）
        patch.news = merged.slice(merged.length - MAX_LIST_ITEMS)
      } else {
        // 未超上限：增量 setData 只传输新增条目的路径
        capped.forEach((item, i) => {
          patch[`news[${base + i}]`] = item
        })
      }
      this.setData(patch)
    } catch (error) {
      wx.showToast({ title: error instanceof Error ? error.message : '新闻加载失败', icon: 'none' })
    } finally {
      this.setData({ loadingMoreNews: false })
    }
  },
  /**
   * 公告列表触底追加：条数达到 MAX_LIST_ITEMS 后不再追加（超过上限时丢弃最旧条目），
   * 未超上限时用增量 setData（announcements[N] 下标路径）只传输新增条目。
   */
  async onLoadMoreAnnouncements() {
    if (this.data.loadingMoreAnnouncements || !this.data.announcementHasMore) return
    // 列表已达显示上限：不再追加，announcementHasMore 置 false 使加载态自洽（下拉刷新会重建列表恢复）
    if (this.data.announcements.length >= MAX_LIST_ITEMS) {
      this.setData({ announcementHasMore: false })
      return
    }
    const nextPage = this.data.announcementPage + 1
    this.setData({ loadingMoreAnnouncements: true })
    try {
      const items = await newsApi.getAnnouncements(this.data.code, nextPage)
      const base = this.data.announcements.length
      const merged = this.data.announcements.concat(items)
      const patch: Record<string, unknown> = {
        announcementPage: nextPage,
        announcementHasMore: items.length >= ANNOUNCEMENT_PAGE_SIZE,
      }
      if (merged.length > MAX_LIST_ITEMS) {
        // 超上限：整体重建并丢弃最旧条目（公告越旧价值越低，保留最新）
        patch.announcements = merged.slice(merged.length - MAX_LIST_ITEMS)
      } else {
        // 未超上限：增量 setData 只传输新增条目的路径
        items.forEach((item, i) => {
          patch[`announcements[${base + i}]`] = item
        })
      }
      this.setData(patch)
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
    const view = computeChangeView(quote.pct_change)
    const tone: PosterTone = view.changeClass
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
              changeText: view.changeText,
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
    trackEvent('share.trigger')
    return {
      title: this.data.quote?.name || '股票详情',
      // 分享统一经首页中转：先进入首页，再自动跳转到本页（见 utils/share.ts）
      path: buildSharePath('stock-detail', { code: this.data.code }),
      imageUrl: SHARE_IMAGE_URL,
    }
  },
})
