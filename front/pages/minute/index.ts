import { rootStore } from '../../stores/root.store'
import { bindTheme, unbindTheme } from '../../utils/theme'
import { startAutoRefresh, stopAutoRefresh } from '../../utils/auto-refresh'
import { fetchEastmoneyUlistQuote } from '../../api/quote'
import { resolveMinuteSources } from '../../config/minute'
import {
  fetchMinuteData,
  hasMinuteSources,
  mergeMinuteQuoteInfo,
  sparseVolumeNote,
  type MinuteQuoteInfo,
} from '../../utils/minute'
import { resolveMinuteSession, type MinuteSessionKind } from '../../utils/minute-session'
import type { MinutePoint } from '../../types/stock'
import { formatChange, formatNumber, formatVolume } from '../../utils/formatter'
import { buildSharePath, SHARE_IMAGE_URL } from '../../utils/share'
import {
  APP_NAME,
  formatShareStamp,
  type PosterData,
  type PosterTone,
} from '../../utils/share-poster'
import type { MinutePosterChartData } from '../../utils/minute-poster'

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
    /**
     * 连续加载失败次数（成功即清零）：
     * - 首次失败 → 展示错误 + 重试按钮；
     * - 第二次及以后失败 → 切换为「暂无数据」引导空态（数据源暂未更新 / 网络不可达等）。
     */
    failCount: 0,
    /** 暂无数据引导态：无分时源（如 KOSDAQ/TOPIX/VIX）或多次加载失败时展示 */
    noData: false,
    /** 暂无数据态的引导文案（说明原因 / 给用户下一步指引） */
    noDataDesc: '',
    /** 暂无数据态是否提供「重新加载」按钮（无分时源时不可重试，多次加载失败时可重试） */
    noDataRetryable: false,
    points: [] as MinutePoint[],
    preClose: 0,
    sourceLabel: '',
    minuteNote: '',
    /** 交易时段模型（utils/minute-session.ts），由数据源 code + 命中的源计算，透传给分时图 */
    session: 'continuous' as MinuteSessionKind,
    quote: null as MinuteQuoteView | null,
    /** 分享海报数据（头部 + 行情指标分区；分时图由 share-poster 组件按 minutePoster 绘制） */
    posterData: null as PosterData | null,
    /** 分享海报内嵌分时图数据（points + 昨收 + 时段，传给 share-poster 组件） */
    minutePoster: null as MinutePosterChartData | null,
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
    const code = decodeURIComponent(options.code || '')
    const name = decodeURIComponent(options.name || '')
    // 分时取数代码：显式 mcode 优先（外盘/会话切换口径），缺省用展示 code
    const mcode = decodeURIComponent(options.mcode || '') || code
    this.setData({
      code,
      name,
      mcode,
      // 分享原图的小程序入口：与 onShareAppMessage 卡片分享同一路径（经首页中转），
      // 接收方按 code/name/mcode 还原同一标的，避免默认入口落在「当前页且无参数」导致无法加载；
      // 分享路径统一不带前导斜杠（见 utils/share.ts 的 buildSharePath）
      shareEntrancePath: buildSharePath('minute', {
        code,
        name,
        mcode: mcode && mcode !== code ? mcode : undefined,
      }),
    })
    if (!hasMinuteSources(mcode)) {
      // 无分时源（KOSDAQ / TOPIX / VIX 等刻意不配置的标的）：直接展示「暂无数据」引导空态，
      // 无需重试（重试也无法取到数据）。通常经分享链接进入，卡片入口已屏蔽。
      this.setData({
        loading: false,
        noData: true,
        noDataDesc: '该指标暂不支持分时图，请回到行情页查看实时数据',
        noDataRetryable: false,
      })
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
   * 基础信息（今开/最高/最低/昨收/成交量）并发拉东财 ulist 报价（与分时同 secid），
   * 缺字段回退分时推算（代理合成/交叉汇率/Yahoo 兜底无单一 secid 时整体回退）。
   */
  async loadData(options?: { silent?: boolean }) {
    if (this.data.requesting) return
    const { silent = false } = options ?? {}
    lastMinuteRequestAt = Date.now()
    this.setData({ requesting: true })
    if (!silent) this.setData({ loading: true, error: '', noData: false })
    try {
      const code = this.data.mcode || this.data.code
      const emSecid = resolveMinuteSources(code)?.em ?? null
      const [result, quote] = await Promise.all([
        fetchMinuteData(code),
        emSecid ? fetchEastmoneyUlistQuote(emSecid) : Promise.resolve(null),
      ])
      if (result) {
        // 完整时段铺空白：按取数 code 确定交易时段（日股口径已在分类中区分）
        const session = resolveMinuteSession(code)
        // 东财韩/日市场分钟量稀疏（部分分钟量=0），附加数据口径提示（见 utils/minute.ts sparseVolumeNote）
        const dataNote = sparseVolumeNote(result.points, result.source, session)
        // 基础信息：东财 ulist 报价优先，缺字段回退分时推算（见 utils/minute.ts mergeMinuteQuoteInfo）
        const info = mergeMinuteQuoteInfo(result.points, result, quote)
        this.setData({
          loading: false,
          failCount: 0,
          points: result.points,
          preClose: info.preClose ?? 0,
          sourceLabel: `数据来源：${result.sourceLabel}`,
          minuteNote: [result.note, dataNote].filter(Boolean).join('；'),
          session,
          quote: this.buildQuote(result.points, info),
          posterData: this.buildPosterData(result.points, info),
          minutePoster: {
            points: result.points,
            preClose: info.preClose ?? 0,
            session,
            title: `${this.data.name} · 当日分时`,
          },
        })
      } else if (!silent) {
        // 查不到数据：首次失败展示「错误 + 重试」，第二次及以后失败引导「暂无数据」
        // （数据源暂未更新 / 网络不可达等），样式见 index.wxml 的 no-data-card / error-card
        const failCount = this.data.failCount + 1
        const reset = {
          loading: false,
          failCount,
          points: [],
          preClose: 0,
          sourceLabel: '',
          minuteNote: '',
          quote: null,
          posterData: null,
          minutePoster: null,
        }
        if (failCount >= 2) {
          this.setData({
            ...reset,
            error: '',
            noData: true,
            noDataDesc:
              '暂时无法获取该指标的分时数据，可能是数据源暂未更新或网络不可达，请稍后重试',
            noDataRetryable: true,
          })
        } else {
          this.setData({
            ...reset,
            error: '分时数据加载失败，请点击下方按钮重试',
            noData: false,
            noDataDesc: '',
            noDataRetryable: false,
          })
        }
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
    const changeClass: MinuteQuoteView['changeClass'] =
      change === null || change === 0 ? 'flat' : change > 0 ? 'up' : 'down'

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
  /** 组装分享海报数据（头部 + 行情指标分区；分时图由 share-poster 组件按 minutePoster 绘制） */
  buildPosterData(points: MinutePoint[], info: MinuteQuoteInfo): PosterData {
    const last = points[points.length - 1]
    const price = last && Number.isFinite(last.price) ? last.price : null
    const pre =
      info.preClose !== null && Number.isFinite(info.preClose) && info.preClose > 0
        ? info.preClose
        : null
    const change = price !== null && pre !== null ? price - pre : null
    const pct = change !== null && pre !== null && pre !== 0 ? (change / pre) * 100 : null
    const tone: PosterTone = change === null || change === 0 ? 'flat' : change > 0 ? 'up' : 'down'

    const lastAvg = last?.avg

    return {
      title: this.data.name || '行情分时',
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
              changeText: pct !== null ? formatChange(pct) : '',
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
  onRetry() {
    void this.loadData()
  },
  /** 顶栏分享按钮：调起 share-poster 组件生成并预览海报 */
  onSharePoster() {
    const poster = this.selectComponent('#sharePoster') as unknown as { open(): void } | null
    if (poster) poster.open()
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
      imageUrl: SHARE_IMAGE_URL,
    }
  },
})
