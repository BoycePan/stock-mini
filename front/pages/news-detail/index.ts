import { getNewsDetail, type NewsDetail } from '../../utils/storage'
import { rootStore } from '../../stores/root.store'
import { bindTheme, unbindTheme } from '../../utils/theme'

/** 微信 onLoad 的 options 不保证自动解码，做一次安全解码兜底 */
function decodeQuery(value: string | undefined): string {
  if (!value) return ''
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

Page({
  data: {
    theme: rootStore.settings.theme,
    loading: true,
    news: null as NewsDetail | null,
    error: '',
    copied: false,
  },
  onLoad(options: Record<string, string | undefined>) {
    bindTheme(this)
    const title = decodeQuery(options.title)
    const url = decodeQuery(options.url)
    const cached = getNewsDetail()
    const news =
      cached && cached.url === url ? cached : { title, summary: '', url, source: '', time: '' }
    this.setData({
      loading: false,
      news,
      error: news.title && news.url ? '' : '新闻详情缺失',
    })
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
      success: () => {
        this.setData({ copied: true })
        wx.showToast({
          title: '已复制，请在浏览器打开',
          icon: 'none',
          duration: 2200,
        })
      },
    })
  },
  onUnload() {
    unbindTheme(this)
  },
  onShareAppMessage() {
    const news = this.data.news
    return { title: news?.title || '新闻详情', path: '/pages/news/index' }
  },
})
