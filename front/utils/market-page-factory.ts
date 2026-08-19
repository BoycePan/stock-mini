/**
 * createMarketPage — 行情页工厂函数
 *
 * asia / metals / global 三个页面逻辑完全对称，仅 pageKey 与加载文案不同。
 * 通过此工厂统一管理生命周期，避免三处重复维护。
 *
 * 用法：
 *   createMarketPage({ pageKey: 'asia', loadingText: '...', loadingDesc: '...' })
 */
import { createStoreBindings } from 'mobx-miniprogram-bindings'
import { rootStore } from '../stores/root.store'
import { startAutoRefresh, stopAutoRefresh } from './auto-refresh'
import type { MarketSection } from '../types/market'
import { metricViewModel } from './market'
import { registerStoreBinding, releaseStoreBindings } from './store-bindings'
import { bindTheme, unbindTheme } from './theme'

export type MarketPageKey = 'asia' | 'metals' | 'global'

export interface MarketPageOptions {
  /** 页面标识，与路由、store key 一致 */
  pageKey: MarketPageKey
  /** 加载中主文本 */
  loadingText: string
  /** 加载中副文本 */
  loadingDesc: string
  /** 是否启用分享（目前仅 global 需要） */
  enableShare?: boolean
}

export function createMarketPage(opts: MarketPageOptions) {
  const { pageKey, enableShare = false } = opts

  const shareHandlers = enableShare
    ? {
        onShare() {
          wx.showShareMenu({ withShareTicket: true })
          wx.showToast({ title: '请使用右上角分享', icon: 'none' })
        },
        onShareAppMessage(): WechatMiniprogram.Page.ICustomShareContent {
          return { title: '市场追踪助手', path: `/pages/${pageKey}/index` }
        },
      }
    : {}

  return Page({
    data: {
      theme: rootStore.settings.theme,
      activeTab: pageKey,
      loading: true,
      sections: [] as MarketSection[],
      statusLabel: '',
      statusTone: 'rest' as string,
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
            loading: () => rootStore.market.loading[pageKey],
            error: () => rootStore.market.errors[pageKey],
            statusLabel: () => rootStore.market.pages[pageKey]?.statusLabel ?? '',
            statusTone: () => rootStore.market.pages[pageKey]?.statusTone ?? 'rest',
            updatedLabel: () => rootStore.market.pages[pageKey]?.updatedLabel ?? '',
            sections: () =>
              (rootStore.market.pages[pageKey]?.sections ?? []).map((section) => ({
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
        await rootStore.market.loadPage(pageKey, { force: force || silent, silent })
      } catch (error) {
        if (silent) {
          console.warn(`[${pageKey}] 自动刷新失败:`, error)
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

    ...shareHandlers,
  })
}
