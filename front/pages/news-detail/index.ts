import { createStoreBindings } from 'mobx-miniprogram-bindings'
import { getNewsDetail, saveNewsDetail, type NewsDetail } from '../../utils/storage'
import { newsApi } from '../../api/news'
import { rootStore } from '../../stores/root.store'
import { bindTheme, unbindTheme } from '../../utils/theme'
import { registerStoreBinding, releaseStoreBindings } from '../../utils/store-bindings'
import { buildRichHtml, stripHtml } from '../../utils/html'
import { buildSharePath, SHARE_IMAGE_URL } from '../../utils/share'
import { APP_NAME, formatShareStamp, type PosterData } from '../../utils/share-poster'

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
    /** 分享海报数据（标题 + 摘要段落，无 K 线纯文本海报） */
    posterData: null as PosterData | null,
  },
  onLoad(options: Record<string, string | undefined>) {
    bindTheme(this)
    // 分享进入：URL 带 id（onShareAppMessage 分享路径回带），按 id 调 /news/{id} 拉取明细；
    // 列表进入不带 id，直接展示本地缓存 / URL 参数，不请求接口。
    const id = decodeQuery(options.id)
    if (id) {
      void this.loadFromApi(id, {
        title: decodeQuery(options.title),
        url: decodeQuery(options.url),
      })
      return
    }
    const title = decodeQuery(options.title)
    const url = decodeQuery(options.url)
    const cached = getNewsDetail()
    const news =
      cached && cached.url === url ? cached : { title, summary: '', url, source: '', time: '' }
    this.applyNews(news)
  },
  /**
   * 把新闻明细写入页面并注册富文本主题绑定
   * （富文本颜色随主题注入：closure 捕获当前摘要原文，主题切换时自动重算）。
   */
  applyNews(news: NewsDetail) {
    this.setData({
      loading: false,
      news,
      error: news.title || news.summary ? '' : '新闻详情缺失',
      posterData: this.buildPosterData(news),
    })
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
  /**
   * 分享进入：按 id 拉取单条新闻明细；失败时降级展示分享 URL 携带的标题 / 原文链接，避免白屏。
   */
  async loadFromApi(id: string, fallback: { title: string; url: string }) {
    this.setData({ loading: true })
    try {
      const item = await newsApi.getById(id)
      const news: NewsDetail = {
        id: item.id != null ? String(item.id) : id,
        title: item.title,
        summary: item.summary ?? '',
        url: item.url,
        source: item.source ?? '',
        time: item.time ?? '',
      }
      // 与列表进入一致：写入缓存，便于再次进入 / 转发分享
      saveNewsDetail(news)
      this.applyNews(news)
    } catch (error) {
      console.warn('[news-detail] 按 id 拉取新闻明细失败:', error)
      wx.showToast({ title: error instanceof Error ? error.message : '加载失败', icon: 'none' })
      this.applyNews({
        id,
        title: fallback.title,
        summary: '',
        url: fallback.url,
        source: '',
        time: '',
      })
    }
  },
  /**
   * 组装分享海报数据：
   * - 头部主标题用来源名（页面 detail-source-badge 的文案，短文案不会省略号）；
   * - 新闻标题放正文上方（heroText）整行多行展示，不省略号；
   * - 正文为摘要段落（不放原文链接）；不传 klines，纯文本海报。
   */
  buildPosterData(news: NewsDetail): PosterData {
    const summary = stripHtml(news.summary || '').trim()
    const sections: PosterData['sections'] = [
      {
        title: '新闻摘要',
        // 无摘要时给占位文案，保证海报始终有正文分区
        text: summary || '原文摘要暂未获取，可打开「市场追踪助手」小程序查看完整内容。',
      },
    ]
    return {
      title: news.source || '财经新闻',
      heroText: news.title || '',
      subtitle: APP_NAME,
      statusText: '',
      stamp: formatShareStamp(new Date()),
      includeWatermark: true,
      sections,
    }
  },
  /** 顶栏分享按钮：调起 share-poster 组件生成并预览海报 */
  onSharePoster() {
    const poster = this.selectComponent('#sharePoster') as unknown as { open(): void } | null
    if (poster) poster.open()
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
      // 分享统一经首页中转：先进入首页，再自动跳转到本页（见 utils/share.ts）；
      // 携带 id：接收方从外部直接进入分享页时，详情页按 id 调 /news/{id} 拉取明细
      path: buildSharePath('news-detail', { id: news?.id, title: news?.title, url: news?.url }),
      imageUrl: SHARE_IMAGE_URL,
    }
  },
})
