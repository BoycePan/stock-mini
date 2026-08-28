/**
 * 大盘云图个股「当日分时图」页（packageTreemap 分包）：
 * - 从云图钻取个股层点击进入（原跳转 stock-detail，现改为本页只看分时，与云图同分包不跨包）
 * - 数据源：东财 push2delay 直连（与云图同域，公开接口）——
 *   - 分时线：GET /api/qt/stock/trends2/get（fetchEastmoneyMinute，ndays=1 当日分钟线）
 *   - 基础信息：GET /api/qt/ulist.np/get（fetchEastmoneyUlistQuote，今开/最高/最低/昨收/成交量）
 * - A 股固定交易时段（09:30-11:30 + 13:00-15:00，session='ashare'）：未到收盘时右侧未来分钟自动留白
 * - 页面可见期间每 8s 静默刷新一次（utils/auto-refresh），不可见时暂停
 * - 双主题兼容（bindTheme），根节点 class="page theme-{{theme}}"
 */

import { rootStore } from '../../../stores/root.store'
import { bindTheme, unbindTheme } from '../../../utils/theme'
import { startAutoRefresh, stopAutoRefresh } from '../../../utils/auto-refresh'
import { fetchEastmoneyMinute } from '../../../api/minute'
import { fetchEastmoneyUlistQuote } from '../../../api/quote'
import { mergeMinuteQuoteInfo, type MinuteQuoteInfo } from '../../../utils/minute'
import type { MinutePoint } from '../../../types/stock'
import { computeChangeView } from '../../../utils/market'
import { formatChange, formatNumber, formatVolume } from '../../../utils/formatter'

/** 分时数据自动刷新间隔：8s（与 packageQuote 分时页一致） */
const MINUTE_REFRESH_INTERVAL = 8000
/** 模块级共享（跨页面实例），用于 onShow 立即刷新门闩：距上次请求不足 5s 不补刷 */
let lastMinuteRequestAt = 0

/** 6 位 A 股代码 → 东财 secid：6/9 开头为沪市（1.xxxxxx），其余为深市（0.xxxxxx） */
function aShareSecid(code: string): string {
  const market = /^[69]/.test(code) ? 1 : 0
  return `${market}.${code}`
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
  /** 基准价名称（A 股恒为昨收） */
  preCloseLabel: '昨收' | '昨结算'
}

Page({
  data: {
    theme: rootStore.settings.theme,
    /** 6 位股票代码（入参 code） */
    code: '',
    /** 股票名称（入参 name） */
    name: '',
    /** 东财 secid（由 code 推导，如 0.002384） */
    secid: '',
    loading: true,
    /** 是否有请求进行中（含静默刷新），供自动刷新跳过并发 */
    requesting: false,
    error: '',
    points: [] as MinutePoint[],
    preClose: 0,
    /** A 股固定时段（09:30-11:30 + 13:00-15:00），分时图按真实时钟铺点、未来分钟留白 */
    session: 'ashare',
    sourceLabel: '',
    updatedText: '',
    quote: null as MinuteQuoteView | null,
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
    const code = decodeURIComponent(options.code || '')
    const name = decodeURIComponent(options.name || '')
    this.setData({ code, name, secid: code ? aShareSecid(code) : '' })
    await this.loadData()
  },
  onShow() {
    startAutoRefresh(this, lastMinuteRequestAt, MINUTE_REFRESH_INTERVAL)
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
   * 拉取分时数据（东财 trends2 分时 + ulist 基础信息并发，与分时同 secid）。
   * - 静默刷新（silent）：不闪 loading，成功后原地更新数据，失败保留旧数据不打扰；
   * - 常规加载（首屏 / 下拉 / 重试）：展示 loading 与错误态；
   * - 已有请求进行中时直接跳过（防并发）。
   */
  async loadData(options?: { silent?: boolean }) {
    if (this.data.requesting) return
    const { silent = false } = options ?? {}
    lastMinuteRequestAt = Date.now()
    this.setData({ requesting: true })
    if (!silent) this.setData({ loading: true, error: '' })
    try {
      const secid = this.data.secid
      if (!secid) {
        if (!silent) this.setData({ loading: false, error: '缺少股票代码' })
        return
      }
      const [result, quote] = await Promise.all([
        fetchEastmoneyMinute(secid),
        fetchEastmoneyUlistQuote(secid),
      ])
      if (result && result.points.length) {
        // 基础信息：东财 ulist 报价优先，缺字段回退分时推算（见 utils/minute.ts mergeMinuteQuoteInfo）
        const info = mergeMinuteQuoteInfo(result.points, result, quote)
        this.setData({
          loading: false,
          error: '',
          points: result.points,
          preClose: info.preClose ?? 0,
          sourceLabel: '数据来源：东方财富分时',
          session: 'ashare',
          quote: this.buildQuote(result.points, info),
          updatedText: this.updatedTimeText(),
        })
      } else if (!silent) {
        this.setData({
          loading: false,
          error: '分时数据加载失败，请点击下方按钮重试',
          points: [],
          preClose: 0,
          sourceLabel: '',
          updatedText: '',
          quote: null,
        })
      }
    } finally {
      this.setData({ requesting: false })
    }
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
      // 成交量单位统一展示「手」（报价 f5：A股为手，按展示口径加单位）
      volumeText: info.hasVolume ? `${formatVolume(info.volume)}手` : formatVolume(info.volume),
      hasVolume: info.hasVolume,
      preClose: pre !== null ? pre.toFixed(2) : '--',
      preCloseLabel: info.preCloseLabel,
    }
  },
  /** 数据更新时间文本（HH:mm:ss，随 8s 静默刷新变化） */
  updatedTimeText(): string {
    const now = new Date()
    const hh = String(now.getHours()).padStart(2, '0')
    const mm = String(now.getMinutes()).padStart(2, '0')
    const ss = String(now.getSeconds()).padStart(2, '0')
    return `${hh}:${mm}:${ss}`
  },
  onRetry() {
    void this.loadData()
  },
  onUnload() {
    stopAutoRefresh(this)
    unbindTheme(this)
  },
})
