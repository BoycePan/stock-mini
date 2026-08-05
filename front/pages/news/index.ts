import { newsApi } from '../../api/news'
import { getTheme, type ThemeMode } from '../../utils/storage'
import type { NewsItem } from '../../types/stock'

Page({
  data: {
    theme: getTheme() as ThemeMode,
    loading: true,
    items: [] as NewsItem[],
    error: '',
    title: '财经新闻',
  },
  async onLoad(options: Record<string, string | undefined>) {
    this.setData({ title: options.code ? `${options.code} 新闻` : '财经新闻' })
    await this.loadData(options.code)
  },
  onShow() {
    this.setData({ theme: getTheme() })
  },
  async loadData(code?: string) {
    this.setData({ loading: true, error: '' })
    try {
      const items = code ? await newsApi.getStockNews(code) : await newsApi.getFeed()
      this.setData({ loading: false, error: '', items })
    } catch (error) {
      this.setData({
        loading: false,
        error: error instanceof Error ? error.message : '新闻加载失败',
      })
    }
  },
  onItemTap(event: WechatMiniprogram.BaseEvent) {
    const url = (event.currentTarget as unknown as { dataset: { url: string } }).dataset.url
    if (url)
      wx.setClipboardData({
        data: url,
        success: () => wx.showToast({ title: '链接已复制', icon: 'success' }),
      })
  },
})
