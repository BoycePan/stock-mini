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
    activeTab: 'metals',
    loading: true,
    sections: [] as MarketSection[],
    statusLabel: '',
    statusTone: 'rest',
    updatedLabel: '',
    error: '',
  },
  onLoad() {
    bindTheme(this)
    registerStoreBinding(
      this,
      createStoreBindings(this, {
        store: rootStore.market,
        fields: {
          loading: () => rootStore.market.loading['metals'],
          error: () => rootStore.market.errors['metals'],
          statusLabel: () => rootStore.market.pages['metals']?.statusLabel ?? '',
          statusTone: () => rootStore.market.pages['metals']?.statusTone ?? 'rest',
          updatedLabel: () => rootStore.market.pages['metals']?.updatedLabel ?? '',
          sections: () =>
            (rootStore.market.pages['metals']?.sections ?? []).map((section) => ({
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
      await rootStore.market.loadPage('metals', { force: force || silent, silent })
    } catch (error) {
      if (silent) {
        console.warn('[metals] 自动刷新失败:', error)
      }
    }
  },
  onRetry() {
    void this.loadData({ force: true })
  },
  onTabChange(event: WechatMiniprogram.CustomEvent<{ key: string }>) {
    const key = event.detail.key
    if (key !== this.data.activeTab) wx.redirectTo({ url: `/pages/${key}/index` })
  },
})
