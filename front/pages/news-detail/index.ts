import { getTheme, getNewsDetail, type ThemeMode, type NewsDetail } from '../../utils/storage'

Page({
  data: {
    theme: getTheme() as ThemeMode,
    loading: true,
    news: null as NewsDetail | null,
    error: '',
  },
  onLoad(options: Record<string, string | undefined>) {
    const title = options.title || ''
    const url = options.url || ''
    const cached = getNewsDetail()
    const news =
      cached && cached.url === url ? cached : { title, summary: '', url, source: '', time: '' }
    this.setData({
      loading: false,
      news,
      error: news.title && news.url ? '' : '新闻详情缺失',
    })
  },
  onShow() {
    this.setData({ theme: getTheme() })
  },
  onShare() {
    wx.showShareMenu({ withShareTicket: true })
    wx.showToast({ title: '请使用右上角分享', icon: 'none' })
  },
  onCopyLink() {
    const url = this.data.news?.url
    if (!url) return
    wx.setClipboardData({
      data: url,
      success: () => wx.showToast({ title: '链接已复制', icon: 'success' }),
    })
  },
  onShareAppMessage() {
    const news = this.data.news
    return { title: news?.title || '新闻详情', path: '/pages/news/index' }
  },
})
