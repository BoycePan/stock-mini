import { createStoreBindings } from 'mobx-miniprogram-bindings'
import { getNewsDetail, type NewsDetail } from '../../utils/storage'
import { rootStore } from '../../stores/root.store'
import { bindTheme, unbindTheme } from '../../utils/theme'
import { registerStoreBinding, releaseStoreBindings } from '../../utils/store-bindings'
import { buildRichHtml } from '../../utils/html'
import { buildSharePath } from '../../utils/share'

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
    /** 清洗后可直接交给 <rich-text> 渲染的正文 HTML；纯文本摘要时为空串，回退普通 <text> */
    richHtml: '',
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
      error: news.title || news.summary ? '' : '新闻详情缺失',
    })
    // 富文本颜色随主题注入：主题切换时自动重算（closure 捕获 onLoad 时的摘要原文）
    const summary = news.summary
    registerStoreBinding(
      this,
      createStoreBindings(this, {
        store: rootStore.settings,
        fields: {
          richHtml: () => buildRichHtml(summary, rootStore.settings.theme),
        },
        actions: [],
      }),
    )
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
    releaseStoreBindings(this)
    unbindTheme(this)
  },
  onShareAppMessage() {
    const news = this.data.news
    return {
      title: news?.title || '新闻详情',
      // 分享统一经首页中转：先进入首页，再自动跳转到本页（见 utils/share.ts）
      path: buildSharePath('news-detail', { title: news?.title, url: news?.url }),
    }
  },
})
