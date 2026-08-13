import { createStoreBindings } from 'mobx-miniprogram-bindings'
import { rootStore } from '../../stores/root.store'
import { startAutoRefresh, stopAutoRefresh } from '../../utils/auto-refresh'
import { saveNewsDetail } from '../../utils/storage'
import { registerStoreBinding, releaseStoreBindings } from '../../utils/store-bindings'
import { bindTheme, unbindTheme } from '../../utils/theme'

interface NewsItemView {
  title: string
  summary: string
  url: string
  source: string
  time: string
}

Page({
  data: {
    theme: rootStore.settings.theme,
    activeTab: 'finance',
    loading: true,
    news: [] as NewsItemView[],
    statusLabel: '',
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
          loading: () => rootStore.market.loading['finance'],
          error: () => rootStore.market.errors['finance'],
          statusLabel: () => rootStore.market.pages['finance']?.statusLabel ?? '',
          updatedLabel: () => rootStore.market.pages['finance']?.updatedLabel ?? '',
          news: () =>
            (
              rootStore.market.pages['finance']?.sections.find((item) => item.id === 'finance-news')
                ?.metrics ?? []
            ).map((metric) => ({
              title: metric.name,
              summary: metric.detail?.summary ?? '',
              url: metric.detail?.url ?? '',
              source: metric.detail?.source ?? '',
              time: metric.detail?.time ?? '',
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
    const failed = Boolean(rootStore.market.errors['finance'])
    wx.showToast({
      title: failed ? '刷新失败' : '刷新成功',
      icon: failed ? 'none' : 'success',
    })
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
      await rootStore.market.loadPage('finance', { force: force || silent, silent })
    } catch (error) {
      if (silent) {
        console.warn('[finance] 自动刷新失败:', error)
      }
    }
  },
  onRetry() {
    void this.loadData({ force: true })
  },
  onItemTap(event: WechatMiniprogram.BaseEvent) {
    const index = (event.currentTarget as unknown as { dataset: { index?: number } }).dataset.index
    if (index === undefined) return
    const item = this.data.news[index]
    if (!item?.url || !item.title) return
    saveNewsDetail({
      title: item.title,
      summary: item.summary,
      url: item.url,
      source: item.source,
      time: item.time,
    })
    wx.navigateTo({
      url: `/pages/news-detail/index?title=${encodeURIComponent(item.title)}&url=${encodeURIComponent(item.url)}`,
    })
  },
  onTabChange(event: WechatMiniprogram.CustomEvent<{ key: string }>) {
    const key = event.detail.key
    if (key !== this.data.activeTab) wx.redirectTo({ url: `/pages/${key}/index` })
  },
})
