import { fetchAllIndustryBoards } from '../../../api/industry-boards'
import {
  filterIndustryRows,
  sortIndustryRows,
  type IndustryBoardRow,
  type PctSortDir,
} from '../../../utils/industry-boards'
import { rootStore } from '../../../stores/root.store'
import { startAutoRefresh, stopAutoRefresh } from '../../../utils/auto-refresh'
import { computeChangeView } from '../../../utils/market'
import { bindTheme, unbindTheme } from '../../../utils/theme'

/** 列表自动刷新间隔：60s（全量 496 行，刷新节奏比 100 行列表放慢，避免频繁重渲染） */
const LIST_REFRESH_INTERVAL = 60000
/** 模块级共享（跨页面实例）：onShow 立即刷新门闩，距上次请求不足 5s 不补刷 */
let lastListRequestAt = 0

/** 列表行展示模型（涨跌幅文本 + 着色） */
interface IndustryRowView extends IndustryBoardRow {
  pctText: string
  pctClass: 'up' | 'down' | 'flat'
}

function toView(item: IndustryBoardRow): IndustryRowView {
  const pct = computeChangeView(item.pct)
  return {
    ...item,
    pctText: pct.changeText,
    pctClass: pct.changeClass,
  }
}

/**
 * A股全部行业板块 列表页（纯前端直连东财 clist/get，分页拉全量行业清单）。
 * 覆盖东财行业板块 496 项（含 石油石化/煤炭/钢铁/化工/农林牧渔/医疗服务/影视院线
 * 等一级~三级细分）。支持按名称/代码过滤 + 按涨跌幅排序，仅展示涨跌幅（板块无价格）。
 */
Page({
  data: {
    theme: rootStore.settings.theme,
    loading: true,
    error: '',
    /** 是否有请求进行中（含静默刷新），供自动刷新跳过并发 */
    requesting: false,
    /** 已拉取的原始条目（未排序/未过滤） */
    rawItems: [] as IndustryBoardRow[],
    /** 当前展示条目（过滤 + 排序后的视图） */
    items: [] as IndustryRowView[],
    /** 名称/代码过滤词 */
    query: '',
    /** 涨跌幅排序方向：默认领涨在前 */
    sortDir: 'desc' as PctSortDir,
    /** 行业总数（过滤前），头部展示 */
    totalCount: 0,
    updatedLabel: '',
  },

  isLoading() {
    return this.data.requesting
  },

  /** 页面是否仍为当前展示页（页面栈最后一项）：轮询触发前据此校验 */
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

  /** 重算展示列表（内存过滤 + 排序，不重新请求） */
  refreshView() {
    const { rawItems, query, sortDir } = this.data
    const rows = sortIndustryRows(filterIndustryRows(rawItems, query), sortDir)
    this.setData({ items: rows.map(toView) })
  },

  /**
   * 拉取全部行业板块。
   * - 静默刷新（silent）：不闪 loading，成功原地更新，失败保留旧数据；
   * - 常规加载（首屏 / 下拉 / 重试）：展示 loading 与错误态；
   * - 已有请求进行中直接跳过（防并发）。
   */
  async loadData(options?: { silent?: boolean }) {
    if (this.data.requesting) return
    const { silent = false } = options ?? {}
    lastListRequestAt = Date.now()
    this.setData({ requesting: true })
    if (!silent) this.setData({ loading: true, error: '' })
    try {
      const items = await fetchAllIndustryBoards()
      if (!items.length) {
        if (!silent) {
          this.setData({
            loading: false,
            error: '行业板块加载失败，请点击下方按钮重试',
            items: [],
            rawItems: [],
            totalCount: 0,
          })
        }
        return
      }
      const sortDir = this.data.sortDir
      this.setData(
        {
          loading: false,
          error: '',
          rawItems: items,
          totalCount: items.length,
          sortDir,
          updatedLabel: this.buildUpdatedLabel(),
        },
        () => this.refreshView(),
      )
    } catch (error) {
      console.warn('[industry-all] 加载异常:', error)
      if (!silent) {
        this.setData({
          loading: false,
          error: '行业板块加载失败，请点击下方按钮重试',
          items: [],
          rawItems: [],
          totalCount: 0,
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

  onRetry() {
    void this.loadData()
  },

  /** 搜索框输入：名称/代码过滤（内存过滤） */
  onSearchInput(event: WechatMiniprogram.BaseEvent & { detail: { value: string } }) {
    this.setData({ query: event.detail.value ?? '' }, () => this.refreshView())
  },

  onSearchClear() {
    this.setData({ query: '' }, () => this.refreshView())
  },

  /** 涨跌幅排序：点击切换 领涨榜（降序）/ 领跌榜（升序） */
  onSortToggle() {
    const next: PctSortDir = this.data.sortDir === 'desc' ? 'asc' : 'desc'
    this.setData({ sortDir: next }, () => this.refreshView())
  },

  onUnload() {
    stopAutoRefresh(this)
    unbindTheme(this)
  },
})
