import { rootStore } from '../../stores/root.store'
import { bindTheme, unbindTheme } from '../../utils/theme'
import { startAutoRefresh, stopAutoRefresh } from '../../utils/auto-refresh'
import { fetchMinuteData, hasMinuteSources } from '../../utils/minute'
import { resolveMinuteSession, type MinuteSessionKind } from '../../utils/minute-session'
import type { MinutePoint } from '../../types/stock'
import { formatChange, formatNumber, formatVolume } from '../../utils/formatter'
import { buildSharePath } from '../../utils/share'

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
}

/** 分时数据自动刷新间隔：8s（与 utils/auto-refresh.ts 的 startAutoRefresh intervalMs 参数配合） */
const MINUTE_REFRESH_INTERVAL = 8000
/** 模块级共享（跨页面实例），用于 onShow 立即刷新门闩：距上次请求不足 5s 不补刷 */
let lastMinuteRequestAt = 0

/**
 * 首页卡片当日分时图查看页（纯前端直连外部接口，见 docs/minute-api.md）。
 * 入参：code=首页卡片行情code（如 sh000001 / KS11 / GOLD）、name=展示名；
 * mcode=分时取数专用代码（随会话切换口径，如外盘 GOLD → GOLD-US 取 COMEX），缺省等于 code。
 * 数据源按 东财 → 腾讯 → Yahoo 兜底；页面可见期间每 8s 静默刷新一次。
 */
Page({
  data: {
    theme: rootStore.settings.theme,
    code: '',
    name: '',
    /** 分时取数代码（缺省与 code 相同；不同时用于外盘/会话切换口径） */
    mcode: '',
    loading: true,
    /** 是否有请求进行中（含静默刷新），供自动刷新跳过并发 */
    requesting: false,
    error: '',
    points: [] as MinutePoint[],
    preClose: 0,
    sourceLabel: '',
    minuteNote: '',
    /** 交易时段模型（utils/minute-session.ts），由数据源 code + 命中的源计算，透传给分时图 */
    session: 'continuous' as MinuteSessionKind,
    quote: null as MinuteQuoteView | null,
  },
  isLoading() {
    return this.data.requesting
  },
  async onLoad(options: Record<string, string | undefined>) {
    bindTheme(this)
    const code = decodeURIComponent(options.code || '')
    const name = decodeURIComponent(options.name || '')
    // 分时取数代码：显式 mcode 优先（外盘/会话切换口径），缺省用展示 code
    const mcode = decodeURIComponent(options.mcode || '') || code
    this.setData({ code, name, mcode })
    if (!hasMinuteSources(mcode)) {
      this.setData({ loading: false, error: '该指标暂无分时数据' })
      return
    }
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
   * 拉取分时数据。
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
      const result = await fetchMinuteData(this.data.mcode || this.data.code)
      if (result) {
        this.setData({
          loading: false,
          points: result.points,
          preClose: result.preClose ?? 0,
          sourceLabel: `数据来源：${result.sourceLabel}`,
          minuteNote: result.note ?? '',
          // 完整时段铺空白：按取数 code 确定交易时段（日股口径已在分类中区分）
          session: resolveMinuteSession(this.data.mcode || this.data.code),
          quote: this.buildQuote(result.points, result.preClose),
        })
      } else if (!silent) {
        this.setData({
          loading: false,
          points: [],
          preClose: 0,
          sourceLabel: '',
          minuteNote: '',
          quote: null,
          error: '分时数据加载失败，请下拉或点击重试',
        })
      }
    } finally {
      this.setData({ requesting: false })
    }
  },
  /** 由分时数据推算基本信息（最新价 / 涨跌额 / 涨跌幅 / 今开 / 最高 / 最低 / 均价 / 成交量 / 昨收） */
  buildQuote(points: MinutePoint[], preClose: number | null): MinuteQuoteView {
    const last = points[points.length - 1]
    const price = last && Number.isFinite(last.price) ? last.price : null
    const pre = preClose !== null && Number.isFinite(preClose) && preClose > 0 ? preClose : null
    const change = price !== null && pre !== null ? price - pre : null
    const pct = change !== null && pre !== null && pre !== 0 ? (change / pre) * 100 : null
    const changeClass: MinuteQuoteView['changeClass'] =
      change === null || change === 0 ? 'flat' : change > 0 ? 'up' : 'down'

    const prices = points.map((p) => p.price).filter((v): v is number => Number.isFinite(v))
    const high = prices.length ? Math.max(...prices) : null
    const low = prices.length ? Math.min(...prices) : null
    const totalVolume = points.reduce((sum, p) => sum + (p.volume || 0), 0)

    return {
      price: price !== null ? price.toFixed(2) : '--',
      changeText:
        change !== null && pct !== null
          ? `${change >= 0 ? '+' : ''}${change.toFixed(2)}  ${formatChange(pct)}`
          : '--',
      changeClass,
      open: points[0] && Number.isFinite(points[0].price) ? points[0].price.toFixed(2) : '--',
      high: high !== null ? high.toFixed(2) : '--',
      low: low !== null ? low.toFixed(2) : '--',
      avg:
        last?.avg !== null && last?.avg !== undefined && Number.isFinite(last.avg)
          ? formatNumber(last.avg)
          : '--',
      volumeText: formatVolume(totalVolume),
      hasVolume: totalVolume > 0,
      preClose: pre !== null ? pre.toFixed(2) : '--',
    }
  },
  onRetry() {
    void this.loadData()
  },
  onUnload() {
    stopAutoRefresh(this)
    unbindTheme(this)
  },
  // 显式返回类型：方法体内引用 this.data 时，若无注解会触发 Page 泛型推断循环
  // （TCustom 回退默认值导致 this 上「丢失」loadData 等自定义方法），加注解可打破
  onShareAppMessage(): WechatMiniprogram.Page.ICustomShareContent {
    return {
      title: this.data.name || '行情分时',
      // 分享统一经首页中转：先进入首页，再自动跳转到本页（见 utils/share.ts）
      path: buildSharePath('minute', {
        code: this.data.code,
        name: this.data.name,
        // 取数口径与展示 code 不同时（外盘/会话切换）一并透传，保证分享打开仍是同一标的
        mcode: this.data.mcode && this.data.mcode !== this.data.code ? this.data.mcode : undefined,
      }),
    }
  },
})
