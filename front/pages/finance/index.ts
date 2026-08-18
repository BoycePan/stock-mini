import { createStoreBindings } from 'mobx-miniprogram-bindings'
import { toJS } from 'mobx-miniprogram'
import { rootStore } from '../../stores/root.store'
import { startAutoRefresh, stopAutoRefresh } from '../../utils/auto-refresh'
import { getFinanceCache, saveNewsDetail, setFinanceCache } from '../../utils/storage'
import { registerStoreBinding, releaseStoreBindings } from '../../utils/store-bindings'
import { bindTheme, unbindTheme } from '../../utils/theme'
import type { MarketPageData } from '../../types/market'

interface NewsItemView {
  title: string
  summary: string
  url: string
  source: string
  time: string
}

/** 从页面数据中提取新闻列表（store 绑定与缓存写入共用，保证展示与缓存一致） */
function toNewsView(page?: MarketPageData | null): NewsItemView[] {
  const section = (page?.sections ?? []).find((item) => item.id === 'finance-news')
  return (section?.metrics ?? []).map((metric) => ({
    title: metric.name,
    summary: metric.detail?.summary ?? '',
    url: metric.detail?.url ?? '',
    source: metric.detail?.source ?? '',
    time: metric.detail?.time ?? '',
  }))
}

Page({
  data: {
    theme: rootStore.settings.theme,
    activeTab: 'finance',
    loading: true,
    refreshing: false,
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
          news: () => toNewsView(rootStore.market.pages['finance']),
        },
        actions: [],
      }),
    )
    void this.bootstrap()
  },
  /**
   * 进入页面时的加载策略：先用占位数据（本地缓存 / 会话内数据）立即展示，
   * 避免接口响应慢时长时间 loading；随后**仍然请求**最新数据，
   * 刷新完成后 toast 提示。仅当完全没有可展示数据时走常规 loading 加载。
   */
  async bootstrap() {
    if (!rootStore.market.pages['finance']) {
      const cache = getFinanceCache()
      if (cache) rootStore.market.hydratePage('finance', cache)
    }
    if (rootStore.market.pages['finance']) {
      // 有占位数据：后台静默刷新，完成后 toast 提示
      await this.loadData({ silent: true, toast: true })
      return
    }
    // 首次启动无任何数据：常规加载，展示 loading 态
    await this.loadData()
  },
  async onRefresherRefresh() {
    this.setData({ refreshing: true })
    try {
      await this.loadData({ force: true })
    } finally {
      this.setData({ refreshing: false })
    }
    const failed = Boolean(rootStore.market.errors['finance'])
    wx.showToast({
      title: failed ? '刷新失败' : '刷新成功',
      icon: 'none',
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
  async loadData(options?: { silent?: boolean; force?: boolean; toast?: boolean }) {
    const { silent = false, force = false, toast = false } = options ?? {}
    try {
      await rootStore.market.loadPage('finance', { force: force || silent, silent })
      this.saveFinanceCache()
      if (toast) {
        wx.showToast({ title: '刷新成功', icon: 'none' })
      }
    } catch (error) {
      if (silent) {
        console.warn('[finance] 自动刷新失败:', error)
      }
      if (toast) {
        wx.showToast({ title: '刷新失败', icon: 'none' })
      }
    }
  },
  /** 将最新页面数据写入本地缓存，供下次进入页面时优先展示 */
  saveFinanceCache() {
    const page = rootStore.market.pages['finance']
    if (page) setFinanceCache(toJS(page))
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
