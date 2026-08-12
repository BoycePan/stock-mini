import { createStoreBindings } from 'mobx-miniprogram-bindings'
import { rootStore } from '../../stores/root.store'
import { startAutoRefresh, stopAutoRefresh } from '../../utils/auto-refresh'
import type { MarketSection } from '../../types/market'
import { metricViewModel } from '../../utils/market'
import { registerStoreBinding, releaseStoreBindings } from '../../utils/store-bindings'
import { bindTheme, unbindTheme } from '../../utils/theme'

Page({
  data: {
    theme: rootStore.settings.theme,
    activeTab: 'global',
    loading: true,
    sections: [] as MarketSection[],
    statusLabel: '',
    statusTone: 'rest',
    updatedLabel: '',
    sourceLabel: '实时数据',
    error: '',
  },
  onLoad() {
    bindTheme(this)
    // 行情数据统一放在全局 MarketStore：切页复用缓存、多页面状态即时同步
    registerStoreBinding(
      this,
      createStoreBindings(this, {
        store: rootStore.market,
        fields: {
          loading: () => rootStore.market.loading['global'],
          error: () => rootStore.market.errors['global'],
          statusLabel: () => rootStore.market.pages['global']?.statusLabel ?? '',
          statusTone: () => rootStore.market.pages['global']?.statusTone ?? 'rest',
          updatedLabel: () => rootStore.market.pages['global']?.updatedLabel ?? '',
          sections: () =>
            (rootStore.market.pages['global']?.sections ?? []).map((section) => ({
              ...section,
              metrics: section.metrics.map(metricViewModel),
            })),
        },
        actions: [],
      }),
    )
    void this.loadData()
  },
  async onPullDownRefresh() {
    try {
      await this.loadData({ force: true })
    } finally {
      wx.stopPullDownRefresh()
    }
  },
  onShow() {
    startAutoRefresh(this)
  },
  onHide() {
    stopAutoRefresh(this)
  },
  onUnload() {
    stopAutoRefresh(this)
    releaseStoreBindings(this)
    unbindTheme(this)
  },
  async loadData(options?: { silent?: boolean; force?: boolean }) {
    const { silent = false, force = false } = options ?? {}
    try {
      await rootStore.market.loadPage('global', { force: force || silent, silent })
    } catch (error) {
      if (silent) {
        console.warn('[global] 自动刷新失败:', error)
      }
      // 非静默失败：错误信息已写入 market store，由 store 绑定自动展示
    }
  },
  onRetry() {
    void this.loadData({ force: true })
  },
  onShare() {
    wx.showShareMenu({ withShareTicket: true })
    wx.showToast({ title: '请使用右上角分享', icon: 'none' })
  },
  onShareAppMessage() {
    return { title: '全球市场追踪', path: '/pages/global/index' }
  },
  onTabChange(event: WechatMiniprogram.CustomEvent<{ key: string }>) {
    const key = event.detail.key
    if (key === this.data.activeTab) return
    wx.redirectTo({ url: `/pages/${key}/index` })
  },
})
