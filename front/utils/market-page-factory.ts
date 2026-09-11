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
   * 首页是否展示「配置开关控制的入口卡」——美股市值TOP100 与 A股全部板块
   * （行业板块区入口）共用同一 display 开关（homeShowTop100 / homeShowTop100Dev，
   * 见 pages/global/index.ts 与 utils/system-config.ts resolveTop100Enabled）：
   * 纯视图过滤——不参与数据加载，不影响其他数据加载速度；
   * 函数体读取 rootStore.system.configs，MobX 绑定自动追踪，配置到达时卡片即时出现。
   */
  showHomeEntries?: () => boolean
  /**
   * 首页是否展示「A股指数 + 美股指数」主入口分区（`cn-index` / `us-index` 两个分区，
   * login 配置 showMainEntrance / showMainEntranceDev 驱动，见 pages/global/index.ts 与
   * utils/system-config.ts resolveMainEntranceEnabled）。与 showHomeEntries（仅过滤分区内
   * 的入口卡）不同，本开关**整块过滤分区**：关闭时首页不展示这两个指数分区。
   * 纯视图过滤——数据层（api/market.ts getGlobalMarketPage）恒拉取指数数据，**不影响
   * 实际请求**，也不影响其他分区（宏观经济 / 行业板块等）的展示与请求；
   * 函数体读取 rootStore.system.loginConfig（登录接口下发的 login 配置），MobX 绑定
   * 自动追踪，登录配置到达时分区即时出现/隐藏。仅首页（global）传此选项；
   * 其他页面缺省 true（无此类分区，不影响）。
   */
  showMainEntrance?: () => boolean
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
  // 不再执行首页的数据加载 / 自动刷新（避免中转瞬间多打一次首页请求）。
  // 仅在**已发起**中转（redirectFromShare 返回 true）时记录；redirectTo 失败时由
  // resumeHomeAfterShareFail 清除标记并补做首页初始化，避免首页永久停在 skeleton。
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
      // 分享中转：所有分享统一先进首页，识别到 target 后自动跳转目标页（见 utils/share.ts）。
      // 已发起跳转（返回 true）时刻意跳过首页初始化（onShow 也据 shareRedirectedPages 跳过
      // 自动刷新），避免中转瞬间多打一次首页请求——中转成功时本页随即被 redirectTo 关闭。
      // 返回 false（无 target / 未登记 / 分时开关关闭）或跳转失败（fail 回调，如目标页在分包
      // 且下载失败 / 网络异常，此时本页不会被关闭）时必须走正常首页初始化：否则首页会永久停在
      // skeleton——无 bindTheme、无 registerStoreBinding（loading / sections / error 永不更新）、
      // 不加载数据、不启动自动刷新、重试按钮不可达，只能杀进程恢复。
      if (redirectFromShare(options, () => this.resumeHomeAfterShareFail())) {
        shareRedirectedPages.add(this)
        return
      }
      this.initHomePage()
    },

    /**
     * 首页正常初始化：绑定主题 + store 响应式字段（loading / sections / error / 弹窗公告），
     * 并加载首屏数据。分享中转未发生时走这里，中转失败时同样走这里
     * （见 resumeHomeAfterShareFail），因此不能内联在 onLoad 里。
     */
    initHomePage() {
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
              // 全局页「A股指数 + 美股指数」主入口分区的视图层判读（login 配置
              // showMainEntrance / showMainEntranceDev，showMainEntrance 由 pages/global/index.ts
              // 提供，纯读 store 不触发任何请求）：关闭时整块过滤 cn-index / us-index 分区——
              // 数据层恒拉取指数数据（不影响实际请求），仅首页视图不展示；登录配置到达
              // 即时出现 / 隐藏。分区 id 与 utils/quote-pages.ts buildQuoteGlobalPage 对齐。
              const showMainEntrance = opts.showMainEntrance?.() ?? true
              const isMainEntranceSection = (id: string) => id === 'cn-index' || id === 'us-index'
              // 全局页「配置开关控制的入口卡」的视图层判读：美股市值TOP100（us-top100）与
              // A股全部板块（industry-all，行业板块区入口）共用同一开关（showHomeEntries 由
              // pages/global/index.ts 提供，纯读 store 不触发任何请求）——配置未就绪缺省隐藏、
              // 配置到达即时出现，绝不进入数据加载路径；非全局页恒展示（无此类入口卡）。
              const showHomeEntries = opts.showHomeEntries?.() ?? true
              const isHomeEntryCode = (code: string) =>
                code === 'us-top100' || code === 'industry-all'
              // 分时页入口开关（后台 display 配置 canShowMinute / canShowMinuteDev，见
              // utils/system-config.ts）：关闭时隐藏「分时」角标，
              // 避免展示一个点进去会被拦截的入口；纯读 store，配置到达即时生效。
              const minuteEnabled = isMinuteEnabled()
              return (rootStore.market.pages[pageKey]?.sections ?? [])
                .filter((section) => !isMainEntranceSection(section.id) || showMainEntrance)
                .map((section) => ({
                  ...section,
                  metrics: section.metrics
                    .filter((metric) => !isHomeEntryCode(metric.code ?? '') || showHomeEntries)
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

    /**
     * 分享中转失败兜底（redirectFromShare 的 onFail：redirectTo:fail，当前页不会被关闭）：
     * 清掉中转标记（否则 onShow 会永久提前返回、页面再也起不来），补做被跳过的首页初始化，
     * 并补启动自动刷新与 tabBar 同步——onShow 已在标记存在时提前返回过一次，不会再触发。
     */
    resumeHomeAfterShareFail() {
      shareRedirectedPages.delete(this)
      this.initHomePage()
      this.syncTabBar()
      startAutoRefresh(this, rootStore.market.lastRequestAt[pageKey], MARKET_REFRESH_INTERVAL)
    },

    async onPullDownRefresh() {
      try {
        await this.loadData({ force: true })
      } finally {
        wx.stopPullDownRefresh()
      }
    },

    onShow() {
      // 分享中转已发起的页面不再启动首页自动刷新
      // （中转失败时标记已在 resumeHomeAfterShareFail 中清除，本方法会正常同步 tabBar + 启动刷新）
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
     * 取数代码 = minuteCode ?? code（随会话切换口径，如外盘 GOLD → GOLD-US 取现货 XAUUSD 分时）；
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
      // 行业板块区入口卡（全部板块，见 api/market.ts）：跳转全部板块列表页，不走分时逻辑。
      // 入口卡携带与首页板块区当前展示口径一致的 initialTab（A股板块 → 概念板块；
      // 美股 → 美股概念，见 api/market.ts industry-all 入口构建）：以 URL ?tab= 透传给
      // industry-all 页，页面 onLoad 按此预选默认 tab，与首页展示状态保持一致。
      if (code === 'industry-all') {
        trackEvent('industry.all.enter')
        const tab = metric?.initialTab
        const url = tab
          ? `/packageQuote/pages/industry-all/index?tab=${encodeURIComponent(tab)}`
          : '/packageQuote/pages/industry-all/index'
        wx.navigateTo({ url })
        return
      }
      // 分时页入口开关（后台 display 配置 canShowMinute / canShowMinuteDev，见
      // utils/system-config.ts）：关闭时禁止跳转分时页。
      if (!isMinuteEnabled()) {
        // wx.showToast({ title: '分时行情暂未开放', icon: 'none' })
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
