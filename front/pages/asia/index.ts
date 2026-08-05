import { marketApi } from '../../api/market'
import { getTheme, type ThemeMode } from '../../utils/storage'
import type { MarketPageData, MarketSection } from '../../types/market'
import { metricViewModel } from '../../utils/market'

Page({
  data: {
    theme: getTheme() as ThemeMode,
    activeTab: 'asia',
    loading: true,
    sections: [] as MarketSection[],
    statusLabel: '',
    statusTone: 'rest',
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
      const data = await marketApi.getPage('asia')
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
      sections: data.sections.map((section) => ({
        ...section,
        metrics: section.metrics.map(metricViewModel),
      })),
    })
  },
  onTabChange(event: WechatMiniprogram.CustomEvent<{ key: string }>) {
    const key = event.detail.key
    if (key !== this.data.activeTab) wx.redirectTo({ url: `/pages/${key}/index` })
  },
})
