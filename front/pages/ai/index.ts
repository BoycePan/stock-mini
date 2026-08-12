import { marketApi } from '../../api/market'
import { getTheme, saveNewsDetail, type ThemeMode } from '../../utils/storage'
import type { MarketMetric, MarketPageData, MarketSection } from '../../types/market'
import { metricViewModel } from '../../utils/market'

Page({
  data: {
    theme: getTheme() as ThemeMode,
    activeTab: 'ai',
    loading: true,
    sections: [] as MarketSection[],
    statusLabel: '',
    updatedLabel: '',
    error: '',
  },
  async onLoad() {
    await this.loadData()
  },
  async onPullDownRefresh() {
    try {
      await this.loadData()
    } finally {
      wx.stopPullDownRefresh()
    }
  },
  onShow() {
    this.setData({ theme: getTheme() })
  },
  async loadData() {
    this.setData({ loading: true, error: '' })
    try {
      const data = await marketApi.getPage('ai')
      this.applyData(data)
    } catch (error) {
      this.setData({
        loading: false,
        error: error instanceof Error ? error.message : '数据加载失败',
      })
    }
  },
  applyData(data: MarketPageData) {
    this.setData({
      loading: false,
      statusLabel: data.statusLabel,
      updatedLabel: data.updatedLabel,
      sections: data.sections.map((section) => ({
        ...section,
        metrics: section.metrics.map(metricViewModel),
      })),
    })
  },
  onMetricTap(event: WechatMiniprogram.CustomEvent<{ metric: MarketMetric }>) {
    const detail = event.detail.metric.detail
    if (!detail?.url || !detail.title) return
    saveNewsDetail({
      title: detail.title,
      summary: detail.summary ?? '',
      url: detail.url,
      source: detail.source ?? '',
      time: detail.time ?? '',
    })
    wx.navigateTo({
      url: `/pages/news-detail/index?title=${encodeURIComponent(detail.title)}&url=${encodeURIComponent(detail.url)}`,
    })
  },
  onTabChange(event: WechatMiniprogram.CustomEvent<{ key: string }>) {
    const key = event.detail.key
    if (key !== this.data.activeTab) wx.redirectTo({ url: `/pages/${key}/index` })
  },
})
