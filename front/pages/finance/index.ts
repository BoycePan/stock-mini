import { newsApi } from '../../api/news'
import { createStoreBindings } from 'mobx-miniprogram-bindings'
import { toJS } from 'mobx-miniprogram'
import { rootStore } from '../../stores/root.store'
import { getFinanceCache, saveNewsDetail, setFinanceCache } from '../../utils/storage'
import { registerStoreBinding, releaseStoreBindings } from '../../utils/store-bindings'
import { bindTheme, unbindTheme } from '../../utils/theme'
import { stripHtml } from '../../utils/html'
import { SHARE_IMAGE_URL } from '../../utils/share'
import { formatNewsTime } from '../../utils/formatter'
import type { MarketPageData } from '../../types/market'

interface NewsItemView {
  /** 列表渲染 key：后端部分条目 url 为空，不能用 url 作 wx:key */
  key: string
  title: string
  /** 列表展示用纯文本摘要（后端摘要为 HTML，先剥离标签） */
  summary: string
  /** 原始 HTML 摘要，点进详情页时透传，由详情页渲染富文本 */
  rawSummary: string
  url: string
  source: string
  time: string
  /** 相对时间文案（x分钟前 / x小时前 / MM-DD HH:mm） */
  timeText: string
  /** 是否快讯（财联社电报 / 华尔街见闻快讯等），列表展示「快讯」徽标 */
  flash: boolean
}

/** 快讯类来源关键词：命中则在列表中打上「快讯」标 */
const FLASH_SOURCE_RE = /(快讯|电报|直播)/
/** 财经新闻每页条数（与 store 首屏拉取一致，见 api/market.ts getFinanceMarketPage） */
const FINANCE_PAGE_SIZE = 10

/** 后端新闻条目 / store 指标详情共有的最小字段形状，统一转成列表展示视图 */
interface NewsSourceItem {
  id?: string
  title: string
  summary?: string
  url: string
  source?: string
  time?: string
}

/** 单条新闻 → 列表展示视图（stripHtml / 相对时间 / 快讯徽标），首屏与滚动加载共用 */
function toNewsItemView(item: NewsSourceItem, index: number): NewsItemView {
  const rawSummary = item.summary ?? ''
  const source = item.source ?? ''
  const time = item.time ?? ''
  return {
    key: item.id ?? `finance-news-${index}`,
    title: item.title,
    summary: stripHtml(rawSummary),
    rawSummary,
    url: item.url,
    source,
    time,
    timeText: formatNewsTime(time),
    flash: FLASH_SOURCE_RE.test(source),
  }
}

/** 从 store 页面数据（仅首屏）提取新闻列表视图 */
function toNewsView(page?: MarketPageData | null): NewsItemView[] {
  const section = (page?.sections ?? []).find((item) => item.id === 'finance-news')
  return (section?.metrics ?? []).map((metric, index) =>
    toNewsItemView(
      {
        id: metric.id,
        title: metric.name,
        summary: metric.detail?.summary ?? '',
        url: metric.detail?.url ?? '',
        source: metric.detail?.source ?? '',
        time: metric.detail?.time ?? '',
      },
      index,
    ),
  )
}

/**
 * 财经请求防抖 / 刷新门闩：两次请求的最小间隔 10s
 * （onShow 切换显示补刷新、下拉刷新、悬浮按钮共用同一时间源，见 loadData）。
 */
const MIN_REQUEST_INTERVAL = 10000
/**
 * 模块级共享（跨页面实例），原生 tabBar keep-alive 下页面实例常驻，时间源全局唯一：
 * lastFinanceRequestAt：最近一次真正发起请求的时间戳（loadData 防抖用）。
 */
let lastFinanceRequestAt = 0

/**
 * 是否刚从新闻详情页返回：onItemTap 跳转详情时置位，onShow 消费后清空。
 * 用于区分 onShow 的两种来源——tab 切换回来（保持自动刷新）与详情页返回（不刷新，
 * 避免打断用户已加载的列表与滚动位置）。
 */
let returnedFromDetail = false

/** 悬浮刷新按钮组件（refresh-btn）对外方法：显示/计时逻辑全部在组件内 */
interface RefreshBtnInstance {
  /** 刷新成功回调：记录成功时间，隐藏按钮并安排 10s 后重现 */
  refreshDone(): void
  /** 恢复按钮为可点状态：立即显示（刷新失败 / 防抖拦截场景） */
  restore(): void
  /** 页面显示时同步按钮状态（距上次刷新成功 ≥10s 直接显示，否则按剩余时间计时） */
  sync(): void
}

Page({
  data: {
    theme: rootStore.settings.theme,
    loading: !rootStore.market.pages['finance'] && !getFinanceCache(),
    refreshing: false,
    news: [] as NewsItemView[],
    statusLabel: '',
    updatedLabel: '',
    error: '',
    /** 是否还有下一页（滚动加载用） */
    hasMore: false,
    /** 滚动加载请求中 */
    loadingMore: false,
    /** scroll-view 滚动位置（刷新后回顶用；0/1 交替保证值变化触发滚动） */
    scrollTop: 0,
  },
  isLoading() {
    return rootStore.market.loading['finance']
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
        },
        actions: [],
      }),
    )
    void this.bootstrap()
  },
  /**
   * 进入页面时的加载策略：先用占位数据（本地缓存 / 会话内数据）立即展示，
   * 避免接口响应慢时长时间 loading；随后仍然请求最新数据。
   * 首次进入属于「页面显示触发的刷新」，成功后不弹提示
   * （toast 仅用于下拉刷新 / 悬浮按钮这类用户主动刷新）。
   */
  async bootstrap() {
    if (!rootStore.market.pages['finance']) {
      const cache = getFinanceCache()
      if (cache) rootStore.market.hydratePage('finance', cache)
    }
    // news 不再绑 store：先用 store 当前首屏数据重建列表（无数据时为 []，展示 loading / 空态）
    this.syncNewsFromStore()
    if (rootStore.market.pages['finance']) {
      // 有占位数据：后台静默刷新
      await this.loadData({ silent: true })
      return
    }
    // 首次启动无任何数据：常规加载，展示 loading 态
    await this.loadData()
  },
  async onRefresherRefresh() {
    this.setData({ refreshing: true })
    try {
      const requested = await this.loadData({ force: true })
      if (!requested) {
        // 10s 防抖拦截（距上次请求不足 10s）：未真正发起刷新，恢复按钮可点状态
        this.getRefreshBtn()?.restore()
        return
      }
      const failed = Boolean(rootStore.market.errors['finance'])
      if (failed) {
        // 刷新失败：立即重现悬浮按钮，允许稍后重试
        this.getRefreshBtn()?.restore()
        if (this.isCurrentPage()) {
          wx.showToast({ title: '刷新失败', icon: 'none' })
        }
      } else if (this.isCurrentPage()) {
        // 刷新成功：loadData 内已通知组件重置按钮计时（隐藏并 10s 后重现）
        wx.showToast({ title: '已更新', icon: 'none' })
      }
    } finally {
      this.setData({ refreshing: false })
    }
  },
  onShow() {
    // 同步底部自定义 tabBar 激活态（原生 tabBar keep-alive，onShow 幂等）
    this.syncTabBar()
    // 从新闻详情页返回：不自动刷新（列表 / 滚动位置保持原样），仅同步悬浮按钮状态
    if (returnedFromDetail) {
      returnedFromDetail = false
      this.getRefreshBtn()?.sync()
      return
    }
    // 切换显示（tab 切回）时拉取最新数据：距上次请求 ≥10s 才真正发起（loadData 内 10s 防抖保证），
    // 刷新成功后会重置悬浮按钮计时，因此即将刷新时不在此同步按钮（避免闪一下又消失）
    const willRefresh = Date.now() - lastFinanceRequestAt >= MIN_REQUEST_INTERVAL
    if (!willRefresh) {
      // 10s 内刚请求过：不刷新，仅按距上次刷新成功时间同步悬浮按钮
      this.getRefreshBtn()?.sync()
    }
    void this.loadData({ silent: true })
  },
  onUnload() {
    releaseStoreBindings(this)
    unbindTheme(this)
  },
  /**
   * 请求财经数据。
   * - 防抖：距上次请求不足 10s 时跳过本次请求，返回 false；
   * - 每次请求成功后把最新数据写入本地缓存，并通知悬浮按钮组件重置计时（隐藏、10s 后重现）；
   * - 是否弹 toast 由调用方决定：仅下拉刷新 / 悬浮按钮这类用户主动刷新提示，
   *   页面显示（onShow / 首次进入）触发的自动刷新不提示。
   * @returns 是否真正发起了请求
   */
  async loadData(options?: { silent?: boolean; force?: boolean }): Promise<boolean> {
    const { silent = false, force = false } = options ?? {}
    const now = Date.now()
    if (now - lastFinanceRequestAt < MIN_REQUEST_INTERVAL) return false
    lastFinanceRequestAt = now
    try {
      await rootStore.market.loadPage('finance', { force: force || silent, silent })
      // 刷新成功：以最新首屏重建列表并重置分页（滚动加载追加的条目被清空，回到第一页）
      this.syncNewsFromStore()
      this.saveFinanceCache()
      // 刷新成功：通知悬浮按钮组件重置计时（隐藏、10s 后重现）
      this.getRefreshBtn()?.refreshDone()
    } catch (error) {
      if (silent) {
        console.warn('[finance] 自动刷新失败:', error)
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
  /**
   * 以 store 首屏数据重建列表并重置分页状态。
   * store 只保存财经第一页（getFinanceMarketPage 固定拉 10 条），滚动加载追加的条目
   * 只存在于页面 data，因此 news 不绑 store；刷新 / 缓存水合 / 会话内已有数据时统一从这里重建。
   */
  syncNewsFromStore() {
    const news = toNewsView(rootStore.market.pages['finance'])
    this.setData({
      news,
      hasMore: news.length >= FINANCE_PAGE_SIZE,
      loadingMore: false,
      // 刷新后列表回到第一页，滚动位置同步回顶；scroll-top 值不变不触发，用 0/1 交替保证每次生效
      scrollTop: this.data.scrollTop === 0 ? 1 : 0,
    })
  },
  /**
   * 滚动到底部 / 点击「加载更多」：向后端请求下一页并追加。
   * - 请求中或有加载失败时不重复发起；hasMore 用后端真实标记；
   * - 追加条目与首屏共用 toNewsItemView（摘要剥离 HTML、相对时间、快讯徽标）；
   * - 追加条目 id 为空时 key 用「当前列表长度 + 页内下标」保证全局唯一，避免 wx:key 重复。
   */
  async onLoadMore() {
    if (this.data.loadingMore || !this.data.hasMore) return
    this.setData({ loadingMore: true })
    try {
      const page = Math.floor(this.data.news.length / FINANCE_PAGE_SIZE) + 1
      const { items, hasMore } = await newsApi.getFeedPage(page, FINANCE_PAGE_SIZE, {
        skipLoginWait: true,
      })
      const base = this.data.news.length
      this.setData({
        news: [
          ...this.data.news,
          ...items.map((item, index) => toNewsItemView(item, base + index)),
        ],
        hasMore,
      })
    } catch (error) {
      wx.showToast({ title: error instanceof Error ? error.message : '加载失败', icon: 'none' })
    } finally {
      this.setData({ loadingMore: false })
    }
  },
  /** scroll-view 触底（bindscrolltolower）触发加载更多 */
  onScrollLower() {
    this.onLoadMore()
  },
  onRetry() {
    void this.loadData({ force: true })
  },
  /** 获取悬浮刷新按钮组件实例（组件尚未就绪时返回 null，调用方用可选链保护） */
  getRefreshBtn(): RefreshBtnInstance | null {
    return this.selectComponent('#refresh-btn') as unknown as RefreshBtnInstance | null
  },
  /** 点击悬浮按钮：组件内已自行隐藏，这里触发与下拉刷新相同的刷新流程 */
  onRefreshBtnRefresh() {
    void this.onRefresherRefresh()
  },
  onItemTap(event: WechatMiniprogram.BaseEvent) {
    const index = (event.currentTarget as unknown as { dataset: { index?: number } }).dataset.index
    if (index === undefined) return
    const item = this.data.news[index]
    if (!item?.title) return
    saveNewsDetail({
      title: item.title,
      // 透传原始 HTML 摘要，详情页用 rich-text 渲染富文本
      summary: item.rawSummary,
      url: item.url,
      source: item.source,
      time: item.time,
    })
    // 标记本次跳转详情：返回时 onShow 不触发自动刷新
    returnedFromDetail = true
    wx.navigateTo({
      url: `/pages/news-detail/index?title=${encodeURIComponent(item.title)}&url=${encodeURIComponent(item.url)}`,
    })
  },
  /** 同步底部自定义 tabBar 的激活态到当前页（custom-tab-bar 常驻渲染层，由框架管理） */
  syncTabBar() {
    if (typeof this.getTabBar === 'function') {
      const tabBar = this.getTabBar()
      if (tabBar) tabBar.setData({ selected: 'finance' })
    }
  },
  onShareAppMessage(): WechatMiniprogram.Page.ICustomShareContent {
    return {
      title: '财经新闻',
      path: '/pages/finance/index',
      imageUrl: SHARE_IMAGE_URL,
    }
  },
})
