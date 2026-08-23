import { newsApi } from '../../api/news'
import { createStoreBindings } from 'mobx-miniprogram-bindings'
import { toJS } from 'mobx-miniprogram'
import { rootStore } from '../../stores/root.store'
import { getFinanceCache, saveNewsDetail, setFinanceCache } from '../../utils/storage'
import { registerStoreBinding, releaseStoreBindings } from '../../utils/store-bindings'
import { bindTheme, unbindTheme } from '../../utils/theme'
import { stripHtml, truncateRichHtml } from '../../utils/html'
import { SHARE_IMAGE_URL } from '../../utils/share'
import { formatNewsTime } from '../../utils/formatter'
import type { MarketPageData } from '../../types/market'

interface NewsItemView {
  /** 列表渲染 key：后端部分条目 url 为空，不能用 url 作 wx:key */
  key: string
  /** 后端条目 id：滚动加载时作为游标传给 /news/feed（第一页第一条 id，后端分页去重用） */
  id?: string
  title: string
  /** 列表展示用纯文本摘要（后端摘要为 HTML，先剥离标签） */
  summary: string
  /** 原始 HTML 摘要（已截断到 MAX_RAW_SUMMARY_CHARS），点进详情页时透传，由详情页渲染富文本 */
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
/**
 * 列表最大条数：滚动加载无限追加会让 this.data 与 DOM 持续膨胀（列表常驻原始 HTML 摘要，
 * 每次触底还会全量序列化整个数组），超过上限后丢弃最旧条目，保证内存有上界。
 */
const MAX_NEWS_ITEMS = 100
/**
 * 列表条目透传详情页用的原始摘要最大字符数：单条摘要可能是整篇文章 HTML（数 KB ~ 数十 KB），
 * 在列表层先截断（详情页渲染时还有更严格的 20KB 保护），防止长列表累积撑爆内存。
 */
const MAX_RAW_SUMMARY_CHARS = 10_000

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
  // 摘要先截断再入列表：原始 HTML 只用于跳详情时透传，截断到安全上限防列表内存膨胀
  // （truncateRichHtml 未超限时原样返回，不影响常规短摘要）
  const cappedSummary = truncateRichHtml(rawSummary, MAX_RAW_SUMMARY_CHARS)
  const source = item.source ?? ''
  const time = item.time ?? ''
  // 后端 id 为数字（如 77415），统一转字符串作游标；无 id 时 id 留空（滚动加载不传后端），key 用下标兜底
  const id = item.id ? String(item.id) : undefined
  return {
    key: id ?? `finance-news-${index}`,
    id,
    title: item.title,
    summary: stripHtml(cappedSummary),
    rawSummary: cappedSummary,
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
        // 真实后端 id 存于 metric.detail（见 api/market.ts getFinanceMarketPage），滚动加载作游标用
        id: metric.detail?.id,
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
 * 本页「上次拉取通用新闻」时间戳（毫秒）：needToPull 轻量轮询的比对基准。
 * 每次真正看到最新一页（首屏刷新 loadData / 轮询 checkNewNews 拉到第一页）后更新；
 * 滚动加载拉的是更旧页，不更新。模块级变量即可（页面常驻，tabBar keep-alive），无需持久化——
 * 重启后为 0，首次轮询 needToPull 恒返回 true，退化为「拉最新一条比对」的旧行为，无功能损失。
 */
let lastNewsPullAt = 0
/** 最新新闻轮询间隔：每 10s 检查一次（只拉第一页，与 store 首屏同源，见 checkNewNews） */
const NEWS_POLL_INTERVAL = 30000
let newsPollTimer: ReturnType<typeof setInterval> | null = null
let newsPolling = false
/**
 * 刷新失败重试态：refresh 失败时 restore() 显示的按钮是「重试入口」，
 * 不受轮询隐藏影响（否则 10s 后按钮会被 poll 隐藏，用户无法重试）；
 * 刷新成功后清除。
 */
let refreshFailed = false

/**
 * 是否刚从新闻详情页返回：onItemTap 跳转详情时置位，onShow 消费后清空。
 * 用于区分 onShow 的两种来源——tab 切换回来（保持自动刷新）与详情页返回（不刷新，
 * 避免打断用户已加载的列表与滚动位置）。
 */
let returnedFromDetail = false

/** 悬浮刷新按钮组件（refresh-btn）对外方法：显示/隐藏完全由页面驱动 */
interface RefreshBtnInstance {
  /** 刷新成功回调：隐藏按钮（重新出现由页面轮询按最新新闻驱动） */
  refreshDone(): void
  /** 恢复按钮为可点状态：立即显示（仅刷新失败场景，允许稍后重试） */
  restore(): void
  /** 页面轮询发现最新新闻时调用：显示按钮 */
  show(): void
  /** 轮询确认没有新新闻时调用：隐藏按钮（淡出动画由组件内 CSS 处理） */
  hide(): void
  /** 查询按钮当前是否已显示（轮询判断是否可跳过本轮请求） */
  isShown(): boolean
}

/** 回到顶部按钮组件（back-to-top）对外方法 */
interface BackToTopInstance {
  /** 页面滚动回调：传入最新滚动位置（px），组件内部按「超过一屏 + 停止滚动」决定显示 */
  scroll(scrollTop: number): void
  /** 刷新按钮显示时抑制（true 隐藏回到顶部，两按钮互斥）；false 恢复滚动判定 */
  setSuppressed(active: boolean): void
}

/** 回到顶部组件实例缓存：onScroll 高频调用，避免每次 selectComponent */
let backToTopInstance: BackToTopInstance | null = null
/**
 * 列表代数：syncNewsFromStore（刷新 / 缓存水合）重建列表时 +1。
 * onLoadMore 发起请求前记录、返回后比对：期间若列表已被重建（如下拉刷新），
 * 丢弃过期追加结果，避免「刷新后的新首页 + 旧请求的下一页」混拼出重复条目。
 */
let financeListVersion = 0

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
    /** 下一页页码（滚动加载游标）：列表重建后重置为 2，避免按列表长度反推页码时与去重相互干扰 */
    nextPage: 2,
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
        // 10s 防抖拦截（距上次请求不足 10s）：未真正发起刷新，先停止下拉动画。
        // 悬浮按钮保持当前状态：若此前因最新新闻显示过，轮询会按新 id 重新拉起（自愈）。
        this.setData({ refreshing: false })
        return
      }
      const failed = Boolean(rootStore.market.errors['finance'])
      if (failed) {
        // 刷新失败：立即重现悬浮按钮（允许稍后重试），并抑制回到顶部（两按钮互斥）。
        // 置位 refreshFailed：轮询确认无新新闻时不会把「重试入口」隐藏掉。
        refreshFailed = true
        this.getRefreshBtn()?.restore()
        this.getBackToTop()?.setSuppressed(true)
        if (this.isCurrentPage()) {
          wx.showToast({ title: '刷新失败', icon: 'none' })
        }
      } else if (this.isCurrentPage()) {
        // 刷新成功：loadData 内已隐藏悬浮按钮（重新出现由轮询按最新新闻驱动）
        wx.showToast({ title: '已更新', icon: 'none' })
      }
    } finally {
      this.setData({ refreshing: false })
    }
  },
  onShow() {
    // 同步底部自定义 tabBar 激活态（原生 tabBar keep-alive，onShow 幂等）
    this.syncTabBar()
    // 回到页面：重置刷新失败重试态，按钮显示与否重新由轮询按「本地是否有新新闻」决定
    refreshFailed = false
    // 从新闻详情页返回：不自动刷新（列表 / 滚动位置保持原样），仅恢复轮询
    if (returnedFromDetail) {
      returnedFromDetail = false
      this.startNewsPoll()
      return
    }
    // 切回显示：悬浮刷新按钮此刻已隐藏（页面隐藏时组件自动隐藏），解除对回到顶部的抑制；
    // 随后启动轮询检测最新新闻——若已有新新闻，会重新拉起刷新按钮。
    this.getBackToTop()?.setSuppressed(false)
    this.startNewsPoll()
    // 切换显示（tab 切回）时拉取最新数据：距上次请求 ≥10s 才真正发起（loadData 内 10s 防抖保证）
    void this.loadData({ silent: true })
  },
  onHide() {
    // 页面不可见：停止轮询，避免后台持续请求
    this.stopNewsPoll()
  },
  onUnload() {
    this.stopNewsPoll()
    backToTopInstance = null
    releaseStoreBindings(this)
    unbindTheme(this)
  },
  /**
   * 请求财经数据。
   * - 防抖：距上次请求不足 10s 时跳过本次请求，返回 false；
   * - 每次请求成功后把最新数据写入本地缓存，并隐藏悬浮按钮、解除对回到顶部的抑制；
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
      // 本轮已看到最新一页：更新 needToPull 比对基准（下次轮询据此判断是否还有更新新闻）
      lastNewsPullAt = Date.now()
      // 刷新成功：以最新首屏重建列表并重置分页（滚动加载追加的条目被清空，回到第一页）
      this.syncNewsFromStore()
      this.saveFinanceCache()
      // 刷新成功：清除失败重试态，隐藏悬浮按钮（重新出现由轮询按最新新闻驱动），并解除对回到顶部的抑制
      refreshFailed = false
      this.getRefreshBtn()?.refreshDone()
      this.getBackToTop()?.setSuppressed(false)
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
    // 列表重建：作废在途的滚动加载追加（onLoadMore 返回后按版本号丢弃），并重置分页游标
    financeListVersion += 1
    this.setData({
      news,
      hasMore: news.length >= FINANCE_PAGE_SIZE,
      loadingMore: false,
      nextPage: 2,
      // 刷新后列表回到第一页，滚动位置同步回顶；scroll-top 值不变不触发，用 0/1 交替保证每次生效
      scrollTop: this.data.scrollTop === 0 ? 1 : 0,
    })
  },
  /**
   * 滚动到底部 / 点击「加载更多」：向后端请求下一页并追加。
   * - 请求中或有加载失败时不重复发起；hasMore 用后端真实标记；
   * - 追加条目与首屏共用 toNewsItemView（摘要剥离 HTML / 截断、相对时间、快讯徽标）；
   * - 追加条目 id 为空时 key 用「当前列表长度 + 页内下标」保证全局唯一，避免 wx:key 重复；
   * - 追加条目按 id（无 id 时按 url）去重：feed 为偏移量分页且实时更新，下一页可能与
   *   已加载页重叠，重复条目会造成 wx:key 重复（Do not set same key in wx:key）与列表渲染错乱；
   * - 请求期间列表被刷新重建（下拉刷新 / 自动刷新）时丢弃本次追加（按 financeListVersion 比对）；
   * - 列表条数达到 MAX_NEWS_ITEMS 后不再追加：超过上限时丢弃最旧条目，this.data 内存有上界；
   * - 未超上限时用增量 setData（news[N] 下标路径）只传输新增条目，避免每次触底整数组序列化。
   */
  async onLoadMore() {
    if (this.data.loadingMore || !this.data.hasMore) return
    // 列表已达显示上限：不再追加，hasMore 置 false 使底部加载态自洽（刷新会重建列表恢复）
    if (this.data.news.length >= MAX_NEWS_ITEMS) {
      this.setData({ hasMore: false })
      return
    }
    this.setData({ loadingMore: true })
    const version = financeListVersion
    try {
      const page = this.data.nextPage
      // 滚动加载携带第一页第一条 id（游标）：后端支持时按其去重；不支持 / 忽略时由前端去重兜底
      const anchorId = this.data.news[0]?.id
      const { items, hasMore } = await newsApi.getFeedPage(page, FINANCE_PAGE_SIZE, {
        id: anchorId,
      })
      // 列表已在请求期间重建：本次追加过期，直接丢弃（loadingMore 由 syncNewsFromStore / finally 复位）
      if (version !== financeListVersion) return
      const existing = this.data.news
      const seen = new Set<string>()
      for (const item of existing) {
        const dedupeKey = item.id ?? item.url
        if (dedupeKey) seen.add(dedupeKey)
      }
      const fresh = items.filter((item) => {
        const dedupeKey = item.id ? String(item.id) : item.url
        if (!dedupeKey) return true
        if (seen.has(dedupeKey)) return false
        seen.add(dedupeKey)
        return true
      })
      const base = existing.length
      const freshView = fresh.map((item, index) => toNewsItemView(item, base + index))
      const merged = existing.concat(freshView)
      const patch: Record<string, unknown> = {
        hasMore,
        // 页码显式推进：即使整页被去重清空也不重复请求同一页（避免 offset 滑动时无限重试）
        nextPage: page + 1,
      }
      if (merged.length > MAX_NEWS_ITEMS) {
        // 超上限：整体重建并丢弃最旧条目（新闻越旧价值越低，保留最新），列表内存有上界
        patch.news = merged.slice(merged.length - MAX_NEWS_ITEMS)
      } else {
        // 未超上限：增量 setData 只传输新增条目的路径，避免整数组序列化
        freshView.forEach((item, i) => {
          patch[`news[${base + i}]`] = item
        })
      }
      this.setData(patch)
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
  /** scroll-view 滚动（bindscroll）：把位置转发给回到顶部组件，由其决定是否显示 */
  onScroll(event: WechatMiniprogram.ScrollViewScroll) {
    this.getBackToTop()?.scroll(event.detail.scrollTop)
  },
  /** 点击回到顶部：scroll-view 滚回顶部（scroll-top 值不变不触发，0/1 交替保证每次生效） */
  onBackToTop() {
    this.setData({ scrollTop: this.data.scrollTop === 0 ? 1 : 0 })
  },
  /** 启动最新新闻轮询：立即检查一次，之后每 NEWS_POLL_INTERVAL 一次（onShow 调用，先停旧表幂等） */
  startNewsPoll() {
    if (newsPollTimer) {
      clearInterval(newsPollTimer)
      newsPollTimer = null
    }
    void this.checkNewNews()
    newsPollTimer = setInterval(() => {
      void this.checkNewNews()
    }, NEWS_POLL_INTERVAL)
  },
  /** 停止轮询（onHide / onUnload 调用） */
  stopNewsPoll() {
    if (newsPollTimer) {
      clearInterval(newsPollTimer)
      newsPollTimer = null
    }
  },
  /**
   * 检查是否有最新新闻：先调 needToPull 做轻量判断（服务端新闻更新时间 > 本地上次拉取时间
   * 才返回 true），未超时直接跳过本轮，避免每 10s 都拉一页 feed；返回 true 时再拉第一页
   * （getFeed(1, 1)，与 store 首屏同源），第一页里只要存在「本地已加载列表中没有的条目」就视为有新新闻：
   * - 显示悬浮刷新按钮（用户点击后走与下拉刷新相同的流程）；
   * - 抑制回到顶部按钮（两按钮互斥）。
   * 没有新新闻时同步隐藏按钮（除非处于刷新失败重试态 refreshFailed），保证按钮只在
   * 「有本地没有的新新闻」时出现，不会因历史轮询 / restore() 残留一直挂着。
   * 只比首条 id 会误报：首条 id 缺失 / 列表排序变化 / 最新条目其实已在本地列表中时，
   * 按钮也会出现，而用户并没有新的内容可看；因此按「id 是否已在本地列表」逐一比对。
   * 列表尚未有数据时不拉起（loading / 空态交给页面自身处理）；无 id 的条目无法比对，直接忽略；
   * 轮询失败静默忽略，等待下轮重试；请求在途时不重复发起。
   */
  async checkNewNews() {
    if (newsPolling) return
    // 按钮已显示（有新新闻待刷新）：跳过本轮，无需再发请求
    if (this.getRefreshBtn()?.isShown?.()) return
    newsPolling = true
    try {
      // 先做轻量判断：服务端新闻更新时间未超过上次拉取时间，直接跳过（避免每 10s 都拉一页 feed）
      if (!(await newsApi.needToPull(lastNewsPullAt))) return
      // 只拉最新 1 条：仅用于判断「有没有本地未收录的新新闻」，无需多条
      const items = await newsApi.getFeed(1, 1)
      // 已看到最新一页：更新比对基准（无论有无新新闻都更新，避免服务端时间粒度误差导致反复命中）
      lastNewsPullAt = Date.now()
      if (!items.length || this.data.news.length === 0) return
      const localIds = new Set(
        this.data.news.map((item) => item.id).filter((id): id is string => Boolean(id)),
      )
      const hasNewNews = items.some((item) => Boolean(item.id) && !localIds.has(String(item.id)))
      if (hasNewNews) {
        this.getRefreshBtn()?.show()
        this.getBackToTop()?.setSuppressed(true)
      } else if (!refreshFailed) {
        // 没有新新闻：隐藏按钮并解除对回到顶部的抑制。
        // 只加 show 不加 hide 会「只亮不灭」——按钮一旦因历史轮询 / restore() 显示，
        // 后续轮询即使 hasNewNews=false 也一直挂着（本次 false 仍显示的原因）。
        this.getRefreshBtn()?.hide()
        this.getBackToTop()?.setSuppressed(false)
      }
    } catch {
      // 轮询失败静默，下轮重试
    } finally {
      newsPolling = false
    }
  },
  onRetry() {
    void this.loadData({ force: true })
  },
  /** 获取悬浮刷新按钮组件实例（组件尚未就绪时返回 null，调用方用可选链保护） */
  getRefreshBtn(): RefreshBtnInstance | null {
    return this.selectComponent('#refresh-btn') as unknown as RefreshBtnInstance | null
  },
  /** 获取回到顶部组件实例：onScroll 高频调用，首次获取后缓存（组件尚未就绪时返回 null） */
  getBackToTop(): BackToTopInstance | null {
    if (!backToTopInstance) {
      backToTopInstance = this.selectComponent(
        '#back-to-top',
      ) as unknown as BackToTopInstance | null
    }
    return backToTopInstance
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
      // 缓存真实 id：详情页分享时回带到分享路径（接收方按 id 拉取明细）
      id: item.id,
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
