import { fetchUsTop100 } from '../../../api/us-stocks'
import { rootStore } from '../../../stores/root.store'
import type { UsTopStock } from '../../../types/quote'
import { startAutoRefresh, stopAutoRefresh } from '../../../utils/auto-refresh'
import { formatNumber } from '../../../utils/formatter'
import { computeChangeView } from '../../../utils/market'
import { isMinuteEnabled } from '../../../utils/system-config'
import { bindTheme, unbindTheme } from '../../../utils/theme'
import { trackEvent } from '../../../utils/tracker'
import { maybeShowInterstitial } from '../../../utils/interstitial-ad'
import {
  formatUsMarketCap,
  sortUsStocks,
  usLogoChipTone,
  usLogoUrl,
  type UsLogoChipTone,
  type UsSortDir,
  type UsSortKey,
} from '../../../utils/us-stocks'

/** 列表自动刷新间隔：30s（市值排名变化慢，价格随延迟行情刷新） */
const LIST_REFRESH_INTERVAL = 30000
/** 模块级共享（跨页面实例），用于 onShow 立即刷新门闩：距上次请求不足 5s 不补刷 */
let lastListRequestAt = 0
/**
 * logo 外链加载失败的 code 集合（模块级跨实例共享，随会话累积）。
 * 失败标记若只存在 items 里，每 30s 静默刷新与每次点表头排序都会重建 items 把它重置成 false，
 * `<image wx:if="{{ !item.logoFailed }}">` 随之重新挂载，对这批必然失败的外链再发一轮请求
 * （最多 100 行），既耗流量又反复重建图片节点。条目数有界：仅美股 TOP100 的 code 集合
 * （最多 100 个短字符串），随会话增长也不构成内存问题。
 */
const failedLogoCodes = new Set<string>()

/** logo 加载失败时的兜底字符：优先公司名首字（中文名如「英伟达」→「英」） */
function logoCharOf(item: UsTopStock): string {
  const first = (item.name.trim() || item.code).charAt(0)
  return first || '?'
}

/** 列表行展示模型（价格 / 涨跌 / 市值格式化 + logo 展示字段） */
interface UsTopStockView extends UsTopStock {
  priceText: string
  pctText: string
  pctClass: 'up' | 'down' | 'flat'
  capText: string
  /** 公司 logo 外链地址（financialmodelingprep.com，透明底 PNG） */
  logoUrl: string
  /** logo 底片色调：白图→dark / 深图→light / 其余 auto 随主题 */
  logoTone: UsLogoChipTone
  /** logo 是否加载失败（失败后换公司名首字兜底，不再重试该次渲染） */
  logoFailed: boolean
  /** logo 加载失败兜底字符 */
  logoChar: string
}

function toView(item: UsTopStock): UsTopStockView {
  const pct = computeChangeView(item.pct)
  return {
    ...item,
    priceText: item.price === null ? '--' : formatNumber(item.price),
    pctText: pct.changeText,
    pctClass: pct.changeClass,
    capText: formatUsMarketCap(item.marketCap),
    logoUrl: usLogoUrl(item.code),
    logoTone: usLogoChipTone(item.code),
    // 已确认加载失败的 code 直接置失败态：重建列表（静默刷新 / 排序）后不再重新挂载 <image>
    logoFailed: failedLogoCodes.has(item.code),
    logoChar: logoCharOf(item),
  }
}

/**
 * 美股市值TOP100 列表页（纯前端直连东财 clist/get，docs/us-top100-api.md）。
 * 原样按东财市值排名展示（含杠杆产品等东财口径条目），点击行进入当日分时页
 * （mcode=个股东财 secid，如 105.NVDA，见 config/minute.ts EM_US_SECID_RE 兜底）。
 */
Page({
  data: {
    theme: rootStore.settings.theme,
    loading: true,
    error: '',
    /** 是否有请求进行中（含静默刷新），供自动刷新跳过并发 */
    requesting: false,
    /** 拉取到的原始条目（未排序，100 行；排序在内存进行，不重新请求） */
    rawItems: [] as UsTopStock[],
    /** 当前展示条目（按 sortKey/sortDir 排序后的视图） */
    items: [] as UsTopStockView[],
    /** 排序键：cap=总市值（默认）/ pct=涨跌幅 */
    sortKey: 'cap' as UsSortKey,
    /** 排序方向：默认总市值降序 */
    sortDir: 'desc' as UsSortDir,
    /** 排序引导提示：首次点击排序列后隐藏（页面级，每次进入展示） */
    showSortHint: true,
    updatedLabel: '',
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

  onLoad() {
    bindTheme(this)
    void this.loadData()
  },

  onShow() {
    // 插屏广告：仅「首次进入 / 切 tab / App 回前台」触发，从子页面返回不触发
    // （全局单例 + 频控闸门收敛，见 utils/interstitial-ad.ts 闸门 0）
    maybeShowInterstitial('us-top100', this)
    startAutoRefresh(this, lastListRequestAt, LIST_REFRESH_INTERVAL)
  },

  onHide() {
    stopAutoRefresh(this)
  },

  async onPullDownRefresh() {
    try {
      await this.loadData()
    } finally {
      wx.stopPullDownRefresh()
    }
  },

  /**
   * 拉取美股市值TOP100。
   * - 静默刷新（silent）：不闪 loading，成功后原地更新，失败保留旧数据不打扰；
   * - 常规加载（首屏 / 下拉 / 重试）：展示 loading 与错误态；
   * - 已有请求进行中时直接跳过（防并发）。
   */
  async loadData(options?: { silent?: boolean }) {
    if (this.data.requesting) return
    const { silent = false } = options ?? {}
    lastListRequestAt = Date.now()
    this.setData({ requesting: true })
    if (!silent) this.setData({ loading: true, error: '' })
    try {
      const items = await fetchUsTop100()
      // 排名接口原样返回100条；空列表视为加载失败（正常情况不可能为 0 条）
      if (!items.length) {
        if (!silent) {
          this.setData({
            loading: false,
            error: '美股TOP100加载失败，请点击下方按钮重试',
            items: [],
            rawItems: [],
          })
        }
        return
      }
      this.setData({
        loading: false,
        error: '',
        rawItems: items,
        items: sortUsStocks(items, this.data.sortKey, this.data.sortDir).map(toView),
        updatedLabel: this.buildUpdatedLabel(),
      })
    } catch (error) {
      // fetchUsTop100 内部已降级为空数组，此处兜底（不应触发）
      console.warn('[us-top100] 加载异常:', error)
      if (!silent) {
        this.setData({
          loading: false,
          error: '美股TOP100加载失败，请点击下方按钮重试',
          items: [],
          rawItems: [],
        })
      }
    } finally {
      this.setData({ requesting: false })
    }
  },

  buildUpdatedLabel(): string {
    const d = new Date()
    const hh = String(d.getHours()).padStart(2, '0')
    const mm = String(d.getMinutes()).padStart(2, '0')
    return `${hh}:${mm} 更新`
  },

  /** 点击列标题排序：同一列再次点击切换升降序，切换列时默认降序 */
  onSortTap(event: WechatMiniprogram.TouchEvent) {
    const key = event.currentTarget.dataset.key as UsSortKey | undefined
    if (key !== 'cap' && key !== 'pct') return
    const { sortKey, sortDir } = this.data
    const nextDir: UsSortDir = sortKey === key ? (sortDir === 'desc' ? 'asc' : 'desc') : 'desc'
    if (nextDir === sortDir && key === sortKey) return
    this.setData({
      sortKey: key,
      sortDir: nextDir,
      showSortHint: false,
      items: sortUsStocks(this.data.rawItems, key, nextDir).map(toView),
    })
  },

  onRetry() {
    void this.loadData()
  },

  /** 点击行 → 当日分时图页（复用既有 minute 页，mcode=东财 secid） */
  onRowTap(event: WechatMiniprogram.TouchEvent) {
    const index = event.currentTarget.dataset.index as number | undefined
    if (index === undefined) return
    const item = this.data.items[index]
    if (!item) return
    // 分时页入口开关（后台 display 配置 canShowMinute / canShowMinuteDev，见
    // utils/system-config.ts）：关闭时禁止跳转分时页，并给出可见提示——
    // 静默 return 会让用户以为页面卡死（点击无任何反馈）。
    if (!isMinuteEnabled()) {
      wx.showToast({ title: '分时行情暂未开放', icon: 'none' })
      return
    }
    trackEvent('us.top100.tap', { code: item.code, name: item.name, secid: item.secid })
    wx.navigateTo({
      url:
        `/packageQuote/pages/minute/index` +
        `?code=${encodeURIComponent(item.code)}` +
        `&name=${encodeURIComponent(item.name)}` +
        `&mcode=${encodeURIComponent(item.secid)}`,
    })
  },

  /**
   * logo 加载失败（外链不可达 / 上游无图）：本行换公司名首字兜底，不影响其他行；
   * 同时把 code 记入模块级失败集合——列表下次重建（30s 静默刷新 / 点表头排序）时
   * toView 会直接置 logoFailed，不再对这批必然失败的外链重发请求。
   */
  onLogoError(event: WechatMiniprogram.TouchEvent) {
    const dataset = event.currentTarget.dataset as { code?: string; index?: number }
    if (dataset.code) failedLogoCodes.add(dataset.code)
    const index = dataset.index
    if (index === undefined) return
    this.setData({ [`items[${index}].logoFailed`]: true })
  },

  onUnload() {
    stopAutoRefresh(this)
    unbindTheme(this)
  },
})
