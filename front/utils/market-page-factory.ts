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
import type { MarketMetric, MarketSection } from '../types/market'
import { metricViewModel } from './market'
import { hasMinuteSources } from '../config/minute'
import { registerStoreBinding, releaseStoreBindings } from './store-bindings'
import { bindTheme, unbindTheme } from './theme'
import { redirectFromShare } from './share'

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

  // 分享中转：分享卡片先进首页再自动跳转目标页时，标记该页面实例，跳转完成前
  // 不再执行首页的数据加载 / 自动刷新（避免中转瞬间多打一次首页请求）
  const shareRedirectedPages = new WeakSet<object>()

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
      loading: !rootStore.market.pages[pageKey],
      sections: [] as MarketSection[],
      statusLabel: '',
      statusTone: 'rest' as string,
      updatedLabel: '',
      error: '',
    },

    isLoading() {
      return rootStore.market.loading[pageKey]
    },

    onLoad(options: Record<string, string | undefined> = {}) {
      // 分享中转：所有分享统一先进首页，识别到 target 后自动跳转目标页（见 utils/share.ts）
      if (redirectFromShare(options)) {
        shareRedirectedPages.add(this)
        return
      }
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
                metrics: section.metrics.map((metric) => ({
                  ...metricViewModel(metric),
                  // 标记该卡片是否支持点击查看当日分时（用于「分时」角标与点击行为）
                  minuteAvailable: hasMinuteSources(metric.code ?? ''),
                })),
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
      // 分享中转跳转中的页面不再启动首页自动刷新
      if (shareRedirectedPages.has(this)) return
      // 距上次真正发起的请求超过 5s 才在 onShow 立即补一次刷新
      // （lastRequestAt 由 store 在 loadPage 实际请求处记录，缓存命中不更新）
      startAutoRefresh(this, rootStore.market.lastRequestAt[pageKey])
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

    /**
     * 点击行情卡片 → 查看当日分时图（纯前端，直连外部接口）。
     * 无分时源的卡片（如金店金价、财经新闻）提示后忽略。
     */
    onMetricTap(event: WechatMiniprogram.CustomEvent<{ metric?: MarketMetric }>) {
      const metric = event.detail.metric
      const code = metric?.code ?? ''
      if (!code || !hasMinuteSources(code)) {
        wx.showToast({ title: '该指标暂无分时数据', icon: 'none' })
        return
      }
      wx.navigateTo({
        url: `/pages/minute/index?code=${encodeURIComponent(code)}&name=${encodeURIComponent(metric?.name ?? '')}`,
      })
    },

    ...shareHandlers,
  })
}
