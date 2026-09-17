import { rootStore } from '../../../stores/root.store'
import { bindTheme, unbindTheme } from '../../../utils/theme'
import { startAutoRefresh, stopAutoRefresh } from '../../../utils/auto-refresh'
import { hasKlineSources } from '../../../config/kline'
import {
  fetchMinuteBasicQuote,
  fetchMinuteData,
  hasMinuteSources,
  mergeMinuteQuoteInfo,
  resetMinuteSourceBreaker,
  sparseVolumeNote,
  type MinuteQuoteInfo,
} from '../../../utils/minute'
import { resolveMinuteSession, type MinuteSessionKind } from '../../../utils/minute-session'
import { clearKlineCache, fetchKlineSeries, type KlineTab } from '../../../utils/kline-source'
import type { KlinePoint, MinutePoint } from '../../../types/stock'
import { computeChangeView } from '../../../utils/market'
import { formatChange, formatNumber, formatVolume } from '../../../utils/formatter'
import { trackEvent } from '../../../utils/tracker'
import { maybeShowInterstitial } from '../../../utils/interstitial-ad'
import { buildSharePath, SHARE_IMAGE_URL } from '../../../utils/share'
import {
  APP_NAME,
  formatShareStamp,
  type PosterData,
  type PosterTone,
} from '../../../utils/share-poster'
import type { MinutePosterChartData } from '../../../utils/minute-poster'

/** TAB：分时 / 日K / 周K / 月K / 年K */
type TabKey = 'minute' | KlineTab

interface TabItem {
  key: TabKey
  label: string
  enabled: boolean
}

const KLINE_TAB_KEYS: KlineTab[] = ['day', 'week', 'month', 'year']
const TAB_LABELS: Record<TabKey, string> = {
  minute: '分时',
  day: '日K',
  week: '周K',
  month: '月K',
  year: '年K',
}
/** 图表面板标题（与 TAB 配合说明当前周期） */
const TAB_TITLES: Record<TabKey, string> = {
  minute: '当日分时',
  day: '日K',
  week: '周K',
  month: '月K',
  year: '年K',
}

function isKlineTab(key: TabKey): key is KlineTab {
  return (KLINE_TAB_KEYS as string[]).includes(key)
}

interface MinuteQuoteView {
  price: string
  changeText: string
  changeClass: 'up' | 'down' | 'flat'
  open: string
  high: string
  low: string
  avg: string
  volumeText: string
  /** 是否有成交量数据（无则隐藏「成交量」格子，不占位） */
  hasVolume: boolean
  preClose: string
  /** 基准价名称（昨收 / 昨结算，期货按昨结算口径） */
  preCloseLabel: '昨收' | '昨结算'
}

/** 分时缓存项 */
interface MinuteEntry {
  points: MinutePoint[]
  preClose: number
  session: MinuteSessionKind
  sourceLabel: string
  note: string
  info: MinuteQuoteInfo
  /** 是否含成交量口径（无成交量的外汇等隐藏成交量格） */
  hasVolume: boolean
  at: number
}

/** 单周期 K 线缓存项 */
interface KlineEntry {
  klines: KlinePoint[]
  sourceLabel: string
  note?: string
  at: number
}

/** 页面实例缓存（非响应式，避免大数据集反复进出 setData；WeakMap 随实例回收） */
interface PageCache {
  minute: MinuteEntry | null
  kline: Partial<Record<KlineTab, KlineEntry>>
  /** 各 TAB 连续失败次数（≥2 展示「暂无数据」引导态） */
  fail: Partial<Record<TabKey, number>>
  /** 各 TAB 取数中 */
  loading: Partial<Record<TabKey, boolean>>
  /** 基本信息卡 / 海报数据（分时口径优先，否则由 K 线兜底合成） */
  quote: MinuteQuoteView | null
  poster: PosterData | null
  /** 报价信息是否已由分时口径写入（K 线兜底不再覆盖） */
  quoteFromMinute: boolean
}

const pageCache = new WeakMap<object, PageCache>()

/** 分时数据自动刷新间隔：8s（与 utils/auto-refresh.ts 的 startAutoRefresh intervalMs 参数配合） */
const MINUTE_REFRESH_INTERVAL = 8000
/** TAB 数据新鲜度门闩：距上次请求不足 5s 时不重复请求 */
const SERIES_FRESH_GAP = 5000
/** 模块级共享（跨页面实例），用于 onShow 立即刷新门闩：距上次请求不足 5s 不补刷 */
let lastMinuteRequestAt = 0
/**
 * 实例 → 「待补发的用户主动刷新」标记（WeakMap 随实例回收，不泄漏）。
 * 触发场景：8s 静默轮询在途时用户下拉刷新 / 点「重新加载」——旧实现直接 return 丢弃，
 * 而 onPullDownRefresh 的 finally 会立刻 stopPullDownRefresh，下拉圈一闪即收、数据也没更新。
 */
const pendingUserRefresh = new WeakSet<object>()

/** 微信 onLoad 的 options 不保证自动解码，做一次安全解码兜底 */
function decodeQuery(value: string | undefined): string {
  if (!value) return ''
  try {
    return decodeURIComponent(value)
  } catch {
    // name/code 含孤立 '%'，或微信已自动解码（二次解码非法序列）时 decodeURIComponent 会抛
    // URIError；onLoad 抛异常会导致整页加载失败，故退回原值继续渲染
    return value
  }
}

function cacheOf(target: object): PageCache {
  let cache = pageCache.get(target)
  if (!cache) {
    cache = {
      minute: null,
      kline: {},
      fail: {},
      loading: {},
      quote: null,
      poster: null,
      quoteFromMinute: false,
    }
    pageCache.set(target, cache)
  }
  return cache
}

/**
 * 行情详情页（原「当日分时」页）：分时 / 日K / 周K / 月K / 年K 五个周期 TAB。
 *
 * - 分时：东财 trends2（ndays=1），代理合成与交叉合成口径与首页卡片一致，8s 轮询；
 * - 日/周/月/年 K：腾讯 K 线为主、新浪兜底，年 K 由月 K 聚合（见 utils/kline-source.ts），不做轮询；
 * - 无对应周期数据源的标的，TAB 置灰并给出提示（板块指数、日韩指数等，见 config/kline.ts）；
 * - 图表绘制统一由 packageQuote/components/quote-chart 承担（价格 + 成交量 + MACD 三块面板）。
 *
 * 入参：code=首页卡片行情code（如 sh000001 / KS11 / GOLD）、name=展示名；
 * mcode=取数专用代码（随会话切换口径，如外盘 GOLD → GOLD-US），缺省等于 code。
 */
Page({
  data: {
    theme: rootStore.settings.theme,
    code: '',
    name: '',
    /** 取数代码（缺省与 code 相同；不同时用于外盘/会话切换口径） */
    mcode: '',
    /** 当前 TAB */
    mode: 'minute' as TabKey,
    /** TAB 列表（含可用性） */
    tabs: [] as TabItem[],
    /** 是否 K 线模式（用于面板留白与图表高度类名） */
    klineMode: false,
    /** 页面级空态：该标的没有任何可用周期（无分时源且无 K 线源） */
    fatal: false,
    fatalDesc: '',
    /** 首屏加载（尚无任何周期数据时展示整页加载态） */
    loading: true,
    /** 是否有请求进行中（含静默刷新），供自动刷新跳过并发 */
    requesting: false,
    /** 图表数据（分时 → points + preClose + session；K线 → klines） */
    chartPoints: [] as MinutePoint[],
    chartPreClose: 0,
    chartKlines: [] as KlinePoint[],
    session: 'continuous' as MinuteSessionKind,
    /** 当前周期是否已有数据可画 */
    chartReady: false,
    /** 当前周期取数中（且无缓存） */
    chartLoading: false,
    /** 当前周期的错误 / 空态文案（'' = 正常） */
    chartError: '',
    /** 错误态是否提供「重新加载」 */
    chartRetryable: false,
    /** 数据来源（如「东方财富分时」「腾讯K线」） */
    sourceLabel: '',
    /** 口径提示（代理合成说明 / 期货代理说明等） */
    chartNote: '',
    /** 图表标题：名称 + 周期 */
    panelTitle: '',
    quote: null as MinuteQuoteView | null,
    /** 分享海报数据（头部 + 行情指标分区；图表由 share-poster 按分时或 K 线绘制） */
    posterData: null as PosterData | null,
    /** 分享海报内嵌分时图数据（points + 昨收 + 时段，仅在用户打开海报时组装） */
    minutePoster: null as MinutePosterChartData | null,
    /** 分享海报内嵌 K 线数据（仅在 K 线周期打开海报时组装，避免平时双份 setData 传输） */
    posterKlines: [] as KlinePoint[],
    /** 分享原图（wx.showShareImageMenu）的小程序入口路径：与卡片分享一致经首页中转（utils/share.ts） */
    shareEntrancePath: '',
  },
  isLoading() {
    return this.data.requesting
  },
  /** 页面是否仍为当前展示页（页面栈最后一项）：轮询触发前据此校验，页面不可见时不再发起请求 */
  isCurrentPage(): boolean {
    const pages = getCurrentPages()
    const current = pages[pages.length - 1] as WechatMiniprogram.Page.TrivialInstance | undefined
    return current === (this as unknown as WechatMiniprogram.Page.TrivialInstance)
  },
  async onLoad(options: Record<string, string | undefined>) {
    bindTheme(this)
    const code = decodeQuery(options.code)
    const name = decodeQuery(options.name)
    // 取数代码：显式 mcode 优先（外盘/会话切换口径），缺省用展示 code
    const mcode = decodeQuery(options.mcode) || code
    const tabs = this.buildTabs(mcode)
    const enabled = tabs.filter((tab) => tab.enabled)
    this.setData({
      code,
      name,
      mcode,
      tabs,
      // 分享原图的小程序入口：与 onShareAppMessage 卡片分享同一路径（经首页中转），
      // 接收方按 code/name/mcode 还原同一标的，避免默认入口落在「当前页且无参数」导致无法加载；
      // 分享路径统一不带前导斜杠（见 utils/share.ts 的 buildSharePath）
      shareEntrancePath: buildSharePath('minute', {
        code,
        name,
        mcode: mcode && mcode !== code ? mcode : undefined,
      }),
    })
    if (!enabled.length) {
      // 无分时源且无 K 线源（KOSDAQ / TOPIX / VIX 等刻意不配置的标的）：展示引导空态，
      // 无需重试（重试也取不到数据）。通常经分享链接进入，卡片入口已屏蔽。
      this.setData({
        loading: false,
        fatal: true,
        fatalDesc: '该指标暂不支持分时与 K 线图，请回到行情页查看实时数据',
      })
      return
    }
    // 默认 TAB：分时优先，其次首个可用的 K 线周期
    const initial = enabled[0]?.key ?? 'minute'
    await this.activate(initial, { silent: false })
    this.setData({ loading: false })
  },
  onShow() {
    // 插屏广告：仅「首次进入 / 切 tab / App 回前台」触发，从子页面返回不触发
    // （全局单例 + 频控闸门收敛，见 utils/interstitial-ad.ts 闸门 0）
    maybeShowInterstitial('minute', this)
    this.syncAutoRefresh()
  },
  onHide() {
    stopAutoRefresh(this)
  },
  async onPullDownRefresh() {
    try {
      // 下拉刷新：强制取最新（清 K 线缓存 + 清源级失败熔断 + 忽略新鲜度门闩）
      // 清熔断让用户主动刷新时重新按优先级从头尝试（如刚恢复的腾讯源不必再等 5 分钟）
      clearKlineCache(this.data.mcode || this.data.code)
      resetMinuteSourceBreaker()
      await this.loadData({ force: true })
    } finally {
      wx.stopPullDownRefresh()
    }
  },
  /** 各周期可用性：分时（按 code 优先级：腾讯 → 东财 → Yahoo）、日/周/月/年 K（腾讯/新浪） */
  buildTabs(mcode: string): TabItem[] {
    const klineAvailable = hasKlineSources(mcode)
    const minuteAvailable = hasMinuteSources(mcode)
    const enabledOf: Record<TabKey, boolean> = {
      minute: minuteAvailable,
      day: klineAvailable,
      week: klineAvailable,
      month: klineAvailable,
      year: klineAvailable,
    }
    return (['minute', ...KLINE_TAB_KEYS] as TabKey[]).map((key) => ({
      key,
      label: TAB_LABELS[key],
      enabled: enabledOf[key],
    }))
  },
  /**
   * 切换 / 进入某 TAB：先按缓存渲染当前视图（无缓存则显示面板加载态），再按需取数。
   * @param opts.silent 静默刷新（不展示加载态，失败保留旧数据）
   */
  async activate(mode: TabKey, opts?: { silent?: boolean }) {
    this.setData(this.buildView(mode))
    this.syncAutoRefresh()
    await this.ensureData(mode, opts)
  },
  /** TAB 点击 */
  async onTabTap(event: WechatMiniprogram.TouchEvent) {
    const key = event.currentTarget.dataset.key as TabKey | undefined
    if (!key || key === this.data.mode) return
    const tab = this.data.tabs.find((item) => item.key === key)
    if (!tab) return
    if (!tab.enabled) {
      wx.showToast({ title: `该标的暂无${TAB_TITLES[key]}数据`, icon: 'none' })
      return
    }
    trackEvent('quote.period.switch', { period: key, code: this.data.code })
    await this.activate(key, { silent: false })
  },
  /** 该 TAB 是否已有新鲜缓存（避免同一 TAB 反复请求 / 切回时重复请求） */
  isFresh(mode: TabKey): boolean {
    const cache = cacheOf(this)
    const at = mode === 'minute' ? cache.minute?.at : cache.kline[mode]?.at
    return typeof at === 'number' && Date.now() - at < SERIES_FRESH_GAP
  },
  /** 按需取数：已有新鲜缓存且非强制刷新时直接返回 */
  async ensureData(mode: TabKey, opts?: { silent?: boolean; force?: boolean }) {
    const { silent = false, force = false } = opts ?? {}
    if (!force && this.isFresh(mode)) return
    if (mode === 'minute') {
      await this.loadMinute({ silent })
      return
    }
    await this.loadKline(mode, { silent, force })
  },
  /**
   * 取数统一入口（自动刷新 / 下拉刷新 / 重试都走这里）：
   * 分时为轮询周期；K 线周期不做轮询（历史数据日内变化不大，切 TAB 时按需拉取）。
   */
  async loadData(options?: { silent?: boolean; force?: boolean }) {
    const mode = this.data.mode
    if (mode === 'minute') {
      await this.ensureData(mode, options)
      return
    }
    if (options?.force) await this.ensureData(mode, { ...options, force: true })
  },
  /** 分时 TAB：东财 trends2 当日分钟线 + 基础信息（东财 ulist 报价优先） */
  async loadMinute(options?: { silent?: boolean }) {
    const mode: TabKey = 'minute'
    if (this.data.requesting) {
      // 在途请求（多为静默轮询）占用中：用户主动刷新不能静默丢弃，登记补发标记后返回
      if (!options?.silent) pendingUserRefresh.add(this)
      return
    }
    pendingUserRefresh.delete(this)
    lastMinuteRequestAt = Date.now()
    const cache = cacheOf(this)
    cache.loading[mode] = true
    this.setData({
      requesting: true,
      ...(options?.silent ? {} : this.loadingView(mode)),
    })
    try {
      const code = this.data.mcode || this.data.code
      // 分时序列与基础信息各自按 config/minute.ts 的每 code 优先级取数（缺省 腾讯 → 东财）：
      // 两者并发发起，任一源失败自动切下一个源，互不阻塞。
      const [result, quote] = await Promise.all([
        fetchMinuteData(code),
        fetchMinuteBasicQuote(code),
      ])
      if (result) {
        const session = resolveMinuteSession(code)
        const dataNote = sparseVolumeNote(result.points, result.source, session)
        const info = mergeMinuteQuoteInfo(result.points, result, quote)
        cache.minute = {
          points: result.points,
          preClose: info.preClose ?? 0,
          session,
          sourceLabel: `数据来源：${result.sourceLabel}`,
          note: [result.note, dataNote].filter(Boolean).join('；'),
          info,
          hasVolume: info.hasVolume,
          at: Date.now(),
        }
        cache.fail[mode] = 0
        cache.quote = this.buildQuote(result.points, info)
        cache.poster = this.buildPosterData(result.points, info)
        cache.quoteFromMinute = true
        this.setData({
          quote: cache.quote,
          posterData: cache.poster,
          // 不在这里写 minutePoster：轮询每轮都写会让同一份点数组在同一次 setData 里
          // 序列化两遍，且 share-poster 的 minuteChart 属性每轮换新引用触发无谓同步；
          // 改为用户打开海报时按需组装（见 onSharePoster）。数据变化时旧 minutePoster 作废。
          minutePoster: null,
        })
      } else if (!options?.silent) {
        cache.fail[mode] = (cache.fail[mode] ?? 0) + 1
      }
    } finally {
      cache.loading[mode] = false
      this.setData({ requesting: false })
      if (this.data.mode === mode) this.setData(this.buildView(mode))
      this.applyKlineFallbackQuote()
      // 在途期间用户主动刷新被登记（见上方 requesting 分支）：此刻立即补发一次非静默刷新。
      // 先删标记再补发：补发调用自身不会再登记（此时已无在途请求），故补发只有一次、不会自激循环。
      if (pendingUserRefresh.has(this)) {
        pendingUserRefresh.delete(this)
        void this.loadData()
      }
    }
  },
  /** K 线 TAB：腾讯 K 线（新浪兜底；年 K 由月 K 聚合），结果在 utils/kline-source.ts 内做 60s 缓存 */
  async loadKline(tab: KlineTab, options?: { silent?: boolean; force?: boolean }) {
    const cache = cacheOf(this)
    if (cache.loading[tab]) return
    cache.loading[tab] = true
    if (!options?.silent && this.data.mode === tab) this.setData(this.loadingView(tab))
    try {
      const code = this.data.mcode || this.data.code
      if (options?.force) clearKlineCache(code)
      const result = await fetchKlineSeries(code, tab)
      if (result && result.klines.length >= 2) {
        cache.kline[tab] = {
          klines: result.klines,
          sourceLabel: `数据来源：${result.sourceLabel}`,
          note: result.note,
          at: Date.now(),
        }
        cache.fail[tab] = 0
        this.applyKlineFallbackQuote()
      } else {
        cache.fail[tab] = (cache.fail[tab] ?? 0) + 1
      }
    } finally {
      cache.loading[tab] = false
      if (this.data.mode === tab) this.setData(this.buildView(tab))
    }
  },
  /** 面板加载态（切换 TAB / 重试时先渲染这个视图） */
  loadingView(mode: TabKey): Record<string, unknown> {
    return {
      mode,
      klineMode: isKlineTab(mode),
      panelTitle: `${this.data.name} · ${TAB_TITLES[mode]}`,
      chartReady: false,
      chartLoading: true,
      chartError: '',
      chartRetryable: false,
    }
  },
  /**
   * 由缓存派生出当前 TAB 的视图数据（纯映射，无副作用）：
   * 有数据 → 渲染图表；取数中 → 面板加载态；失败 → 错误 / 暂无数据引导态。
   */
  buildView(mode: TabKey): Record<string, unknown> {
    const cache = cacheOf(this)
    const fail = cache.fail[mode] ?? 0
    const loading = cache.loading[mode] === true
    const base = {
      mode,
      klineMode: isKlineTab(mode),
      panelTitle: `${this.data.name} · ${TAB_TITLES[mode]}`,
      quote: cache.quote,
      posterData: cache.poster,
      // 海报内嵌图与当前 TAB 强相关：切 TAB / 数据刷新后作废旧引用，
      // 由 onSharePoster 在用户真正打开海报时按需组装
      posterKlines: [] as KlinePoint[],
      minutePoster: null as MinutePosterChartData | null,
    }
    if (isKlineTab(mode)) {
      const entry = cache.kline[mode]
      const hasData = !!entry && entry.klines.length >= 2
      return {
        ...base,
        chartPoints: [],
        chartPreClose: 0,
        chartKlines: entry?.klines ?? [],
        session: 'continuous',
        chartReady: hasData,
        chartLoading: loading && !hasData,
        chartError: hasData || loading ? '' : this.emptyText(fail),
        chartRetryable: !hasData && !loading,
        sourceLabel: entry?.sourceLabel ?? '',
        chartNote: entry?.note ?? '',
      }
    }
    const entry = cache.minute
    const hasData = !!entry && entry.points.length >= 2
    return {
      ...base,
      chartPoints: entry?.points ?? [],
      chartPreClose: entry?.preClose ?? 0,
      chartKlines: [],
      session: entry?.session ?? 'continuous',
      chartReady: hasData,
      chartLoading: loading && !hasData,
      chartError: hasData || loading ? '' : this.emptyText(fail),
      chartRetryable: !hasData && !loading,
      sourceLabel: entry?.sourceLabel ?? '',
      chartNote: entry?.note ?? '',
    }
  },
  /** 失败 / 空态文案（首次失败给重试，连续两次起引导「稍后再试」） */
  emptyText(fail: number): string {
    return fail >= 2 ? '该周期暂时无法获取数据，请稍后重试' : '数据加载失败，请点击下方按钮重试'
  },
  /** 重试当前 TAB */
  async onRetry() {
    await this.ensureData(this.data.mode, { silent: false, force: true })
  },
  /**
   * 基本信息卡 / 海报数据兜底：仅当「分时口径不可用」时（无分时源，或分时请求失败），
   * 用当前 K 线最后一根合成一份等价的行情指标，保证 K 线 TAB 下卡片与海报不空。
   */
  applyKlineFallbackQuote() {
    const cache = cacheOf(this)
    if (cache.quoteFromMinute) return
    const mode = this.data.mode
    // 优先用日 K（今开 / 最高 / 最低 / 昨收 都是「当日」口径）；只有日 K 没取到时才退回当前周期，
    // 否则在年 K / 月 K 下会把「该周期的开高低」当成「今日开高低」展示，口径错误
    const entry =
      cache.kline.day ??
      (isKlineTab(mode) ? cache.kline[mode] : undefined) ??
      cache.kline.week ??
      cache.kline.month
    const klines = entry?.klines ?? []
    const last = klines[klines.length - 1]
    if (!last) return
    const prev = klines[klines.length - 2]
    const info: MinuteQuoteInfo = {
      open: last.open,
      high: last.high,
      low: last.low,
      preClose: prev ? prev.close : null,
      preCloseLabel: '昨收',
      volume: last.volume || 0,
      hasVolume: (last.volume || 0) > 0,
    }
    const points: MinutePoint[] = [
      { time: last.time, price: last.close, avg: null, volume: last.volume || 0 },
    ]
    cache.quote = this.buildQuote(points, info)
    cache.poster = this.buildPosterData(points, info)
    if (this.data.mode === 'minute') return
    this.setData({ quote: cache.quote, posterData: cache.poster })
  },
  /** 轮询开关：仅分时需要（K 线周期不轮询），间隔 8s */
  syncAutoRefresh() {
    const mode = this.data.mode
    if (mode === 'minute') {
      startAutoRefresh(this, lastMinuteRequestAt, MINUTE_REFRESH_INTERVAL)
      return
    }
    stopAutoRefresh(this)
  },
  /** 由分时数据 + 基础信息（东财 ulist 报价优先）推算基本信息卡（最新价 / 涨跌额 / 涨跌幅 / 今开 / 最高 / 最低 / 均价 / 成交量 / 昨收） */
  buildQuote(points: MinutePoint[], info: MinuteQuoteInfo): MinuteQuoteView {
    const last = points[points.length - 1]
    const price = last && Number.isFinite(last.price) ? last.price : null
    const pre =
      info.preClose !== null && Number.isFinite(info.preClose) && info.preClose > 0
        ? info.preClose
        : null
    const change = price !== null && pre !== null ? price - pre : null
    const pct = change !== null && pre !== null && pre !== 0 ? (change / pre) * 100 : null
    const changeClass: MinuteQuoteView['changeClass'] = computeChangeView(pct).changeClass

    const lastAvg = last?.avg

    return {
      price: price !== null ? price.toFixed(2) : '--',
      changeText:
        change !== null && pct !== null
          ? `${change >= 0 ? '+' : ''}${change.toFixed(2)} | ${formatChange(pct)}`
          : '--',
      changeClass,
      open: info.open !== null ? info.open.toFixed(2) : '--',
      high: info.high !== null ? info.high.toFixed(2) : '--',
      low: info.low !== null ? info.low.toFixed(2) : '--',
      avg:
        lastAvg !== null && lastAvg !== undefined && Number.isFinite(lastAvg)
          ? formatNumber(lastAvg)
          : '--',
      // 成交量单位统一展示「手」（报价 f5：A股为手、美股为股，按展示口径加单位）
      volumeText: info.hasVolume ? `${formatVolume(info.volume)}手` : formatVolume(info.volume),
      hasVolume: info.hasVolume,
      preClose: pre !== null ? pre.toFixed(2) : '--',
      preCloseLabel: info.preCloseLabel,
    }
  },
  /** 组装分享海报数据（头部 + 行情指标分区；图表由 share-poster 按分时或 K 线绘制） */
  buildPosterData(points: MinutePoint[], info: MinuteQuoteInfo): PosterData {
    const last = points[points.length - 1]
    const price = last && Number.isFinite(last.price) ? last.price : null
    const pre =
      info.preClose !== null && Number.isFinite(info.preClose) && info.preClose > 0
        ? info.preClose
        : null
    const change = price !== null && pre !== null ? price - pre : null
    const pct = change !== null && pre !== null && pre !== 0 ? (change / pre) * 100 : null
    const pctView = computeChangeView(pct)
    const tone: PosterTone = pctView.changeClass

    const lastAvg = last?.avg

    return {
      title: `${this.data.name || '行情'} · ${TAB_TITLES[this.data.mode]}`,
      subtitle: APP_NAME,
      statusText: this.data.code || '',
      stamp: formatShareStamp(new Date()),
      includeWatermark: true,
      sections: [
        {
          title: '行情指标',
          rows: [
            {
              name: '最新价',
              value: price !== null ? price.toFixed(2) : '--',
              // 海报涨跌幅只展示百分比（页面同时展示涨跌额 + 涨跌幅，过长会与数值挤占）
              changeText: pct !== null ? pctView.changeText : '',
              tone,
            },
            {
              name: '开盘',
              value: info.open !== null ? info.open.toFixed(2) : '--',
              changeText: '',
              tone: 'flat',
            },
            {
              name: info.preCloseLabel,
              value: pre !== null ? pre.toFixed(2) : '--',
              changeText: '',
              tone: 'flat',
            },
            {
              name: '最高',
              value: info.high !== null ? info.high.toFixed(2) : '--',
              changeText: '',
              tone: 'flat',
            },
            {
              name: '最低',
              value: info.low !== null ? info.low.toFixed(2) : '--',
              changeText: '',
              tone: 'flat',
            },
            {
              name: '均价',
              value:
                lastAvg !== null && lastAvg !== undefined && Number.isFinite(lastAvg)
                  ? formatNumber(lastAvg)
                  : '--',
              changeText: '',
              tone: 'flat',
            },
            ...(info.hasVolume
              ? [
                  {
                    name: '成交量',
                    value: `${formatVolume(info.volume)}手`,
                    changeText: '',
                    tone: 'flat' as PosterTone,
                  },
                ]
              : []),
          ],
        },
      ],
    }
  },
  /**
   * 组装海报内嵌图表数据，仅在用户打开海报时调用（见 onSharePoster）：
   * - 分时：传 minuteChart（分时走势图）；
   * - K 线周期：不传 minuteChart，由 share-poster 按 klines 绘制 K 线走势图。
   */
  buildPosterChart(): { minutePoster: MinutePosterChartData | null } {
    const mode = this.data.mode
    if (isKlineTab(mode)) return { minutePoster: null }
    if (!this.data.chartPoints.length) return { minutePoster: null }
    return {
      minutePoster: {
        points: this.data.chartPoints,
        preClose: this.data.chartPreClose,
        session: this.data.session,
        title: `${this.data.name} · ${TAB_TITLES[mode]}`,
      },
    }
  },
  /**
   * 顶栏分享按钮：调起 share-poster 组件生成并预览海报。
   * 图表数据在此按需组装（平时不写 minutePoster，见 loadMinute 注释）：
   * setData 回调里再 open()，保证组件图表属性已随本次更新同步完成，
   * 否则海报会因图表数据为空而不绘制。
   */
  onSharePoster() {
    const klineMode = isKlineTab(this.data.mode)
    const chart = this.buildPosterChart()
    this.setData(
      {
        minutePoster: chart.minutePoster,
        // K 线周期：由 share-poster 按 klines 绘制 K 线走势图（minuteChart 为空即可）
        posterKlines: klineMode ? this.data.chartKlines : [],
        // 海报标题随当前周期走（buildPosterData 在取数时生成，这里按最新 TAB 刷新一次）
        posterData: this.data.posterData
          ? {
              ...this.data.posterData,
              title: `${this.data.name || '行情'} · ${TAB_TITLES[this.data.mode]}`,
            }
          : this.data.posterData,
      },
      () => {
        const poster = this.selectComponent('#sharePoster') as unknown as { open(): void } | null
        if (poster) poster.open()
      },
    )
  },
  onUnload() {
    stopAutoRefresh(this)
    // 丢弃待补发的用户刷新：卸载后不应再发起新请求 / 对已销毁页面 setData
    pendingUserRefresh.delete(this)
    pageCache.delete(this)
    unbindTheme(this)
  },
  // 显式返回类型：方法体内引用 this.data 时，若无注解会触发 Page 泛型推断循环
  // （TCustom 回退默认值导致 this 上「丢失」loadMinute 等自定义方法），加注解可打破
  onShareAppMessage(): WechatMiniprogram.Page.ICustomShareContent {
    trackEvent('share.trigger')
    return {
      title: `${this.data.name || '行情'} · ${TAB_TITLES[this.data.mode]}`,
      // 分享统一经首页中转：先进入首页，再自动跳转到本页（见 utils/share.ts）
      path: buildSharePath('minute', {
        code: this.data.code,
        name: this.data.name,
        // 取数口径与展示 code 不同时（外盘/会话切换）一并透传，保证分享打开仍是同一标的
        mcode: this.data.mcode && this.data.mcode !== this.data.code ? this.data.mcode : undefined,
      }),
      imageUrl: SHARE_IMAGE_URL,
    }
  },
})
