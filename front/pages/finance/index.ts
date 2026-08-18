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

/** 财经请求防抖：两次请求的最小间隔（毫秒），接口响应慢时避免被高频请求打爆 */
const MIN_REQUEST_INTERVAL = 5000
/** 模块级共享（跨页面实例），保证切页重建后依然生效 */
let lastFinanceRequestAt = 0

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
      const requested = await this.loadData({ force: true })
      // 防抖：5s 内已请求过，本次未发起请求，不提示
      if (!requested) return
      const failed = Boolean(rootStore.market.errors['finance'])
      if (this.isCurrentPage()) {
        wx.showToast({
          title: failed ? '刷新失败' : '已更新',
          icon: 'none',
        })
      }
    } finally {
      this.setData({ refreshing: false })
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
  /**
   * 请求财经数据。
   * - 防抖：距上次请求不足 5s 时跳过本次请求，返回 false；
   * - toast 仅在页面仍为当前展示页时弹出（切走/卸载后不提示，避免弹在别的页面上）；
   * - 每次请求成功后把最新数据写入本地缓存。
   * @returns 是否真正发起了请求
   */
  async loadData(options?: {
    silent?: boolean
    force?: boolean
    toast?: boolean
  }): Promise<boolean> {
    const { silent = false, force = false, toast = false } = options ?? {}
    const now = Date.now()
    if (now - lastFinanceRequestAt < MIN_REQUEST_INTERVAL) return false
    lastFinanceRequestAt = now
    try {
      await rootStore.market.loadPage('finance', { force: force || silent, silent })
      this.saveFinanceCache()
      if (toast && this.isCurrentPage()) {
        wx.showToast({ title: '刷新成功', icon: 'none' })
      }
    } catch (error) {
      if (silent) {
        console.warn('[finance] 自动刷新失败:', error)
      }
      if (toast && this.isCurrentPage()) {
        wx.showToast({ title: '刷新失败', icon: 'none' })
      }
    }
    return true
  },
  /** 页面是否仍为当前展示页（页面栈最后一项） */
  isCurrentPage(): boolean {
    const pages = getCurrentPages()
    const current = pages[pages.length - 1] as WechatMiniprogram.Page.TrivialInstance | undefined
    return current === (this as unknown as WechatMiniprogram.Page.TrivialInstance)
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
