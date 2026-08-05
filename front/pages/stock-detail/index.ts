import { newsApi } from '../../api/news'
import { stockApi } from '../../api/stock'
import { getTheme, type ThemeMode } from '../../utils/storage'
import type { KlinePoint, NewsItem, StockQuote } from '../../types/stock'
import { calculatePercentChange, formatChange, formatNumber } from '../../utils/formatter'

Page({
  data: {
    theme: getTheme() as ThemeMode,
    code: '',
    loading: true,
    quote: null as (StockQuote & { changeText: string; changeClass: string }) | null,
    klines: [] as Array<KlinePoint & { closeText: string; pctText: string; pctClass: string }>,
    news: [] as NewsItem[],
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
  async loadData(code?: string) {
    const targetCode = code || this.data.code
    if (!targetCode) {
      this.setData({ loading: false, error: '缺少股票代码' })
      return
    }
    this.setData({ loading: true, error: '' })
    try {
      const [quote, klineResult, newsResult] = await Promise.all([
        stockApi.getQuote(targetCode),
        stockApi.getKlines(targetCode, this.data.scale, 30),
        newsApi.getStockNews(targetCode, 1),
      ])
      this.setData({
        loading: false,
        quote: {
          ...quote,
          changeText: formatChange(quote.pct_change),
          changeClass: quote.pct_change >= 0 ? 'up' : 'down',
        },
        klines: klineResult.klines.map((point, index, points) => {
          const previousClose = points[index - 1]?.close
          const pctChange = point.pct_change ?? calculatePercentChange(point.close, previousClose)
          return {
            ...point,
            closeText: formatNumber(point.close),
            pctText: pctChange === null ? '--' : formatChange(pctChange),
            pctClass:
              pctChange === null ? 'flat' : pctChange > 0 ? 'up' : pctChange < 0 ? 'down' : 'flat',
          }
        }),
        news: newsResult,
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
  onNewsTap(event: WechatMiniprogram.BaseEvent) {
    const url = (event.currentTarget as unknown as { dataset: { url?: string } }).dataset.url
    if (!url) return
    wx.setClipboardData({
      data: url,
      success: () => wx.showToast({ title: '链接已复制', icon: 'success' }),
    })
  },
  onShareAppMessage() {
    return { title: this.data.quote?.name || '股票详情' }
  },
})
