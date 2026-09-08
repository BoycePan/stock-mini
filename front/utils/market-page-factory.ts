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
import type { PopupNotice } from '../types/system'
import { metricViewModel } from './market'
import { hasMinuteSources } from '../config/minute'
import { registerStoreBinding, releaseStoreBindings } from './store-bindings'
import { isMinuteEnabled } from './system-config'
import { bindTheme, unbindTheme } from './theme'
import { trackEvent } from './tracker'
import { redirectFromShare, SHARE_IMAGE_URL } from './share'

export type MarketPageKey = 'asia' | 'metals' | 'global'

export interface MarketPageOptions {
  /** 页面标识，与路由、store key 一致 */
  pageKey: MarketPageKey
  /** 加载中主文本 */
  loadingText: string
  /** 加载中副文本 */
  loadingDesc: string
  /**
   * 首页是否展示「美股市值TOP100」入口卡（仅全局页配置，见 pages/global/index.ts）：
   * 页面层按后端 display 配置 + 运行环境判读（utils/system-config.ts resolveTop100Enabled），
   * 是纯视图过滤——不参与数据加载，不影响其他数据加载速度；
   * 函数体读取 rootStore.system.configs，MobX 绑定自动追踪，配置到达时卡片即时出现。
   */
  showTop100?: () => boolean
  /**
   * 弹窗公告（服务端 notices 接口 position='home' 驱动，见 stores/system.store.ts
   * homePopupNotice / utils/popup-notice.ts resolveHomePopupNotice）：响应式 getter，
   * 返回 PopupNotice | null，作为 store 绑定 computed 字段——公告拉取到达时即时出现，
   * wxml 传给通用弹窗组件 components/popup-notice 渲染（组件内部自管理 minVersion +
   * count 天每日一次规则）。不配置则页面无弹窗（asia / metals 页不受影响）。
   */
  popupNotice?: () => PopupNotice | null
  /** 弹窗展示状态缓存键（按公告 id 区分，组件 storageKey）；缺省走组件默认 */
  popupStorageKey?: () => string
}

/** 各行情页分享卡片标题 */
const SHARE_TITLES: Record<MarketPageKey, string> = {
  global: '全球市场行情',
  asia: '亚太市场行情',
  metals: '贵金属行情',
}

/** 行情页自动刷新间隔：8s（与 utils/auto-refresh.ts 的 startAutoRefresh intervalMs 参数配合） */
const MARKET_REFRESH_INTERVAL = 8000

export function createMarketPage(opts: MarketPageOptions) {
  const { pageKey } = opts

  // 分享中转：分享卡片先进首页再自动跳转目标页时，标记该页面实例，跳转完成前
  // 不再执行首页的数据加载 / 自动刷新（避免中转瞬间多打一次首页请求）
  const shareRedirectedPages = new WeakSet<object>()

  const shareHandlers = {
    // 右上角胶囊菜单分享（海报生成由 market-page 组件内处理，见 components/market-page）
    onShareAppMessage(): WechatMiniprogram.Page.ICustomShareContent {
      trackEvent('share.trigger')
      return {
        title: SHARE_TITLES[pageKey],
        path: `/pages/${pageKey}/index`,
        imageUrl: SHARE_IMAGE_URL,
      }
    },
  }

  return Page({
    data: {
      theme: rootStore.settings.theme,
      loading: !rootStore.market.pages[pageKey],
      sections: [] as MarketSection[],
      statusLabel: '',
      statusTone: 'rest' as string,
      updatedLabel: '',
      error: '',
      /** 首页弹窗公告（服务端 notices 接口 position='home' 驱动；wxml 传给 popup-notice 组件） */
      popupNotice: null as PopupNotice | null,
      /** 弹窗展示状态缓存键（按公告 id；无公告时走组件默认，不影响） */
      popupStorageKey: 'popup_notice_state',
    },

    isLoading() {
      return rootStore.market.loading[pageKey]
    },

    /** 页面是否仍为当前展示页（页面栈最后一项）：轮询触发前据此校验，页面不可见时不再发起请求 */
    isCurrentPage() {
      const pages = getCurrentPages()
      const current = pages[pages.length - 1] as WechatMiniprogram.Page.TrivialInstance | undefined
      return current === (this as unknown as WechatMiniprogram.Page.TrivialInstance)
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
            /** 首页弹窗公告（仅配置了 popupNotice getter 的页面有值，如首页）：
             *  纯读 store（rootStore.system.notices），公告拉取到达时即时出现 */
            popupNotice: () => opts.popupNotice?.() ?? null,
            popupStorageKey: () => opts.popupStorageKey?.() ?? 'popup_notice_state',
            sections: () => {
              // 全局页「市值TOP100」入口卡的视图层判读（showTop100 由 pages/global/index.ts
              // 提供，纯读 store 不触发任何请求）：配置未就绪缺省隐藏、配置到达即时出现，
              // 绝不进入数据加载路径，不影响其他数据加载速度；非全局页恒展示（无此入口卡）。
              const showTop100 = opts.showTop100?.() ?? true
              // 分时页入口开关（后台 display 配置 canShowMinute / canShowMinuteDev，见
              // utils/system-config.ts）：关闭时隐藏「分时」角标，
              // 避免展示一个点进去会被拦截的入口；纯读 store，配置到达即时生效。
              const minuteEnabled = isMinuteEnabled()
              return (rootStore.market.pages[pageKey]?.sections ?? []).map((section) => ({
                ...section,
                metrics: section.metrics
                  .filter((metric) => metric.code !== 'us-top100' || showTop100)
                  .map((metric) => ({
                    ...metricViewModel(metric),
                    // 标记该卡片是否支持点击查看当日分时（用于「分时」角标与点击行为）。
                    // 取数代码优先 minuteCode（会话切换口径，如外盘 GOLD→GOLD-US），缺省用展示 code；
                    // 分时入口开关关闭时整体置 false（角标隐藏）。
                    minuteAvailable:
                      hasMinuteSources(metric.minuteCode ?? metric.code ?? '') && minuteEnabled,
                  })),
              }))
            },
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
      // 同步底部自定义 tabBar 激活态（原生 tabBar keep-alive，onShow 幂等）
      this.syncTabBar()
      // 距上次真正发起的请求超过 5s 才在 onShow 立即补一次刷新
      // （lastRequestAt 由 store 在 loadPage 实际请求处记录，缓存命中不更新）
      // 行情页轮询间隔 8s（MARKET_REFRESH_INTERVAL）
      startAutoRefresh(this, rootStore.market.lastRequestAt[pageKey], MARKET_REFRESH_INTERVAL)
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

    /**
     * 同步底部自定义 tabBar 的激活态到当前页（custom-tab-bar 常驻渲染层，由框架管理）。
     * 首次冷启动时 getTabBar() 可能尚未就绪，custom-tab-bar 内部已按路由兜底，无需额外处理。
     */
    syncTabBar() {
      if (typeof this.getTabBar === 'function') {
        const tabBar = this.getTabBar()
        if (tabBar) tabBar.setData({ selected: pageKey })
      }
    },

    /**
     * 点击行情卡片 → 查看当日分时图（纯前端，直连外部接口）。
     * 取数代码 = minuteCode ?? code（随会话切换口径，如外盘 GOLD → GOLD-US 取 COMEX）；
     * 无分时源的卡片（美股时段板块 / 外盘无分时金属 / 金店金价 / 财经新闻）提示后忽略，
     * 绝不跳转到与卡片展示口径不一致的行情。
     */
    onMetricTap(event: WechatMiniprogram.CustomEvent<{ metric?: MarketMetric }>) {
      const metric = event.detail.metric
      const code = metric?.code ?? ''
      const minuteCode = metric?.minuteCode ?? code
      // 入口卡拦截（如 美股指数区「市值TOP100」）：跳转对应列表页，不走分时逻辑。
      // 代码与目标页路由集中在此，新增入口只改这里（见 docs/us-top100-api.md）。
      if (code === 'us-top100') {
        trackEvent('us.top100.enter')
        wx.navigateTo({ url: '/packageQuote/pages/us-top100/index' })
        return
      }
      // 行业板块区入口卡（A股全部行业，见 api/market.ts）：跳转行业全量列表页，不走分时逻辑。
      if (code === 'industry-all') {
        trackEvent('industry.all.enter')
        wx.navigateTo({ url: '/packageQuote/pages/industry-all/index' })
        return
      }
      // 分时页入口开关（后台 display 配置 canShowMinute / canShowMinuteDev，见
      // utils/system-config.ts）：关闭时禁止跳转分时页。
      if (!isMinuteEnabled()) {
        wx.showToast({ title: '分时行情暂未开放', icon: 'none' })
        return
      }
      // 埋点：点击行情卡片（查看分时），上报点的是哪个卡片（code / 名称 / 取数代码）
      trackEvent('card.tap', { code, name: metric?.name, minuteCode })
      if (!minuteCode || !hasMinuteSources(minuteCode)) {
        wx.showToast({
          title: metric?.minuteUnavailableTip ?? '该指标暂无分时数据',
          icon: 'none',
        })
        return
      }
      const query = [
        `code=${encodeURIComponent(code)}`,
        `name=${encodeURIComponent(metric?.name ?? '')}`,
      ]
      if (minuteCode !== code) query.push(`mcode=${encodeURIComponent(minuteCode)}`)
      wx.navigateTo({ url: `/packageQuote/pages/minute/index?${query.join('&')}` })
    },

    ...shareHandlers,
  })
}
