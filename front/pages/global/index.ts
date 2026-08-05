import { marketApi } from '../../api/market'
import { getTheme, type ThemeMode } from '../../utils/storage'
import type { MarketPageData, MarketSection } from '../../types/market'
import { metricViewModel } from '../../utils/market'

Page({
  data: {
    theme: getTheme() as ThemeMode,
    activeTab: 'global',
    loading: true,
    sections: [] as MarketSection[],
    statusLabel: '全球',
    statusTone: 'active',
    updatedLabel: '',
    sourceLabel: '',
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
      const data = await marketApi.getPage('global')
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
      statusTone: data.statusTone,
      updatedLabel: data.updatedLabel,
      sourceLabel: data.source === 'mock' ? '示例数据' : '实时数据',
      sections: data.sections.map((section) => ({
        ...section,
        metrics: section.metrics.map(metricViewModel),
      })),
    })
  },
  onShare() {
    wx.showShareMenu({ withShareTicket: true })
    wx.showToast({ title: '请使用右上角分享', icon: 'none' })
  },
  onShareAppMessage() {
    return { title: '市场魔方助手', path: '/pages/global/index' }
  },
  onTabChange(event: WechatMiniprogram.CustomEvent<{ key: string }>) {
    const key = event.detail.key
    if (key === this.data.activeTab) return
    wx.redirectTo({ url: `/pages/${key}/index` })
  },
})
