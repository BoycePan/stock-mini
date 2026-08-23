import { createStoreBindings } from 'mobx-miniprogram-bindings'
import { getNewsDetail, saveNewsDetail, type NewsDetail } from '../../utils/storage'
import { newsApi } from '../../api/news'
import { rootStore } from '../../stores/root.store'
import { bindTheme, unbindTheme } from '../../utils/theme'
import { registerStoreBinding, releaseStoreBindings } from '../../utils/store-bindings'
import { buildRichHtml, MAX_RICH_HTML_CHARS, stripHtml, truncateRichHtml } from '../../utils/html'
import { buildSharePath, buildShareQuery, SHARE_IMAGE_URL } from '../../utils/share'
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
    /** 纯文本摘要的导语分段：把「【标题】正文」拆成高亮导语 + 正文（仅纯文本路径） */
    summaryLead: '',
    summaryRest: '',
    /** 分享海报数据（标题 + 摘要段落，无 K 线纯文本海报） */
    posterData: null as PosterData | null,
    /** 分享原图（wx.showShareImageMenu）的小程序入口路径：与卡片分享一致经首页中转（utils/share.ts） */
    shareEntrancePath: '',
  },
  onLoad(options: Record<string, string | undefined>) {
    bindTheme(this)
    const id = decodeQuery(options.id)
    // 分享进入：URL 带 id（onShareAppMessage 分享路径回带），按 id 调 /news/{id} 拉取明细；
    // 列表进入不带 id，直接展示本地缓存 / URL 参数，不请求接口。
    if (id) {
      this.setData({ shareEntrancePath: buildSharePath('news-detail', { id }) })
      void this.loadFromApi(id)
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
   * 内存保护：后端摘要可能是整篇文章 HTML（几十 KB ~ 数百 KB），先截断到安全长度，
   * 避免 <rich-text> 节点树 / 全尺寸图片解码撑爆 WebView 内存。
   */
  applyNews(news: NewsDetail) {
    const rawSummary = news.summary ?? ''
    const summary = truncateRichHtml(rawSummary, MAX_RICH_HTML_CHARS)
    const cappedNews: NewsDetail = summary === rawSummary ? news : { ...news, summary }
    // 纯文本摘要的导语分段：开头的【…】拆成高亮导语，其余为正文（HTML 摘要走 rich-text 路径，不受影响）
    const leadMatch = /^【[^】]+】/.exec(summary)
    this.setData({
      loading: false,
      news: cappedNews,
      error: cappedNews.title || summary ? '' : '新闻详情缺失',
      summaryLead: leadMatch ? leadMatch[0] : '',
      summaryRest: leadMatch ? summary.slice(leadMatch[0].length) : '',
      posterData: this.buildPosterData(cappedNews),
      shareEntrancePath: cappedNews.id ? buildSharePath('news-detail', { id: cappedNews.id }) : '',
    })
    console.log('🏷️ index.ts ~ 76 => ', buildSharePath('news-detail', { id: cappedNews.id }))
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
   * 分享进入：按 id 拉取单条新闻明细。
   */
  async loadFromApi(id: string) {
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
      // 与列表进入一致：写入缓存（截断后），便于再次进入 / 转发分享，避免缓存超大摘要
      const capped: NewsDetail = {
        ...news,
        summary: truncateRichHtml(news.summary ?? '', MAX_RICH_HTML_CHARS),
      }
      saveNewsDetail(capped)
      this.applyNews(capped)
    } catch (error) {
      console.warn('[news-detail] 按 id 拉取新闻明细失败:', error)
      wx.showToast({ title: error instanceof Error ? error.message : '加载失败', icon: 'none' })
      this.setData({
        loading: false,
        error: '新闻详情加载失败',
      })
    }
  },
  /**
   * 组装分享海报数据：
   * - 头部主标题用来源名（页面 detail-source-badge 的文案，短文案不会省略号）；
   * - 新闻标题放正文上方（heroText）整行多行展示，不省略号，带左侧蓝色强调条；
   * - 正文为摘要段落（不放原文链接），开头的【…】拆成导语 lead，海报内强调蓝加粗；
   * - 不传 klines，纯文本海报。
   */
  buildPosterData(news: NewsDetail): PosterData {
    const summary = stripHtml(news.summary || '').trim()
    // 与详情页 .detail-summary-lead 一致：开头的【…】作为高亮导语
    const leadMatch = /^【[^】]+】/.exec(summary)
    const sections: PosterData['sections'] = [
      {
        title: '新闻摘要',
        // 无摘要时给占位文案，保证海报始终有正文分区
        text: summary || '原文摘要暂未获取，可打开「市场追踪助手」小程序查看完整内容。',
        ...(leadMatch ? { lead: leadMatch[0] } : {}),
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
  /**
   * 取当前已生成的海报临时图（未生成 / 未就绪时返回空串），
   * 用作卡片分享封面：右上角分享与海报弹窗「转发好友」（open-type=share）共用。
   */
  getPosterImage(): string {
    const poster = this.selectComponent('#sharePoster') as unknown as {
      data?: { sharePreviewPath?: string }
    } | null
    return poster?.data?.sharePreviewPath || ''
  },
  onShareAppMessage() {
    const news = this.data.news
    return {
      title: news?.title || '新闻详情',
      // 分享统一经首页中转：先进入首页，再自动跳转到本页（见 utils/share.ts）；
      // 携带 id：接收方从外部直接进入分享页时，详情页按 id 调 /news/{id} 拉取明细
      path: buildSharePath('news-detail', { id: news?.id }),
      // 已生成海报时用海报图做卡片封面（转发海报即转发新闻卡片）
      imageUrl: this.getPosterImage() || SHARE_IMAGE_URL,
    }
  },
  onShareTimeline() {
    const news = this.data.news
    return {
      title: news?.title || '新闻详情',
      // 朋友圈分享直接落在本页路径，query 携带 id，进入后同样按 id 拉取明细
      query: buildShareQuery({ id: news?.id }),
      imageUrl: this.getPosterImage() || SHARE_IMAGE_URL,
    }
  },
})
