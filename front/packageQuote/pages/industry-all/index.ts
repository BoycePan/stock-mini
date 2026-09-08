import { fetchAllBoards, type BoardKind } from '../../../api/industry-boards'
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

/**
 * A股全部板块（概念板块 + 行业板块）列表页（纯前端直连东财 clist/get，分页拉全量板块清单）。
 * 顶部 tab 切换板块大类，默认展示概念板块：
 * - 概念板块：fs=m:90+t:3+f:!50（约 504 项，华为 / 机器人 / 低空经济 / 代糖概念 等主题）；
 * - 行业板块：fs=m:90+t:2+f:!50（496 项，石油石化 / 煤炭 / 钢铁 / 化工 / 农林牧渔 /
 *   医疗服务 / 影视院线 等一级~三级细分）。
 * 两类均支持按名称/代码过滤 + 按涨跌幅排序，仅展示涨跌幅（板块无价格，点击不做跳转）。
 * 全量清单量小（合计约千行），按板块分类缓存在模块级：切 tab / 二次进入直接复用缓存渲染，
 * 并后台静默刷新保鲜，避免反复整页 loading。
 */

/** 列表自动刷新间隔：60s（全量约千行，刷新节奏比 100 行列表放慢，避免频繁重渲染） */
const LIST_REFRESH_INTERVAL = 60000
/** 模块级共享（跨页面实例）：onShow 立即刷新门闩，距上次请求不足 5s 不补刷 */
let lastListRequestAt = 0

/** tab 顺序：概念板块在前（默认展示），行业板块在后 */
const TAB_ORDER: BoardKind[] = ['concept', 'industry']

/** 单个板块分类的展示元信息（标题 / 文案随 tab 切换） */
interface BoardKindMeta {
  /** tab 标签 */
  label: string
  /** 导航标题 */
  headerTitle: string
  /** 搜索框占位 */
  searchPlaceholder: string
  /** 「共 N 个{{countUnit}}」的计数单位 */
  countUnit: string
  /** 全屏 loading 文案 */
  loadingText: string
  loadingDesc: string
  /** 加载失败错误文案 */
  errorText: string
  /** 无匹配结果文案 */
  emptyText: string
}

const KIND_META: Record<BoardKind, BoardKindMeta> = {
  concept: {
    label: '概念板块',
    headerTitle: '全部概念板块',
    searchPlaceholder: '搜索概念，如 华为 / 机器人',
    countUnit: '概念',
    loadingText: '正在加载全部概念板块',
    loadingDesc: '正在为您同步 A 股全部概念板块涨跌幅，请稍候…',
    errorText: '概念板块加载失败，请点击下方按钮重试',
    emptyText: '未找到匹配的概念，换个关键词试试',
  },
  industry: {
    label: '行业板块',
    headerTitle: 'A股全部行业',
    searchPlaceholder: '搜索行业，如 煤炭 / 影视院线',
    countUnit: '行业',
    loadingText: '正在加载全部行业',
    loadingDesc: '正在为您同步 A 股全部行业板块涨跌幅，请稍候…',
    errorText: '行业板块加载失败，请点击下方按钮重试',
    emptyText: '未找到匹配的行业，换个关键词试试',
  },
}

/** 每个板块分类的模块级清单缓存（跨页面实例共享：量小，切 tab 即时展示） */
interface BoardKindCache {
  /** 已拉取的原始条目（未排序 / 未过滤） */
  rawItems: IndustryBoardRow[]
  /** 是否已有成功数据（供复用缓存渲染；成功且非空才置 true） */
  loaded: boolean
  /** 最近一次成功拉取时间戳（0 = 尚未成功） */
  lastSuccessAt: number
}

function createKindCache(): BoardKindCache {
  return { rawItems: [], loaded: false, lastSuccessAt: 0 }
}

/** 模块级缓存（同一小程序会话内跨页面实例共享） */
const cacheByKind: Record<BoardKind, BoardKindCache> = {
  concept: createKindCache(),
  industry: createKindCache(),
}

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

/** 「HH:MM 更新」标签 */
function buildUpdatedLabel(time: number): string {
  const d = new Date(time)
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return `${hh}:${mm} 更新`
}

Page({
  data: {
    theme: rootStore.settings.theme,
    /** tab 列表（概念板块在前，行业板块在后） */
    tabs: TAB_ORDER.map((key) => ({ key, label: KIND_META[key].label })),
    /** 当前 tab：默认概念板块 */
    activeTab: 'concept' as BoardKind,
    /* ---- 当前 tab 的展示文案（随切 tab 同步，供 wxml 使用） ---- */
    headerTitle: KIND_META.concept.headerTitle,
    searchPlaceholder: KIND_META.concept.searchPlaceholder,
    countUnit: KIND_META.concept.countUnit,
    loadingText: KIND_META.concept.loadingText,
    loadingDesc: KIND_META.concept.loadingDesc,
    emptyText: KIND_META.concept.emptyText,
    loading: true,
    error: '',
    /** 当前展示条目（当前 tab：过滤 + 排序后的视图） */
    items: [] as IndustryRowView[],
    /** 名称/代码过滤词（两类板块共用，切 tab 保留） */
    query: '',
    /** 涨跌幅排序方向：默认领涨在前 */
    sortDir: 'desc' as PctSortDir,
    /** 当前 tab 板块总数（过滤前），头部展示 */
    totalCount: 0,
    updatedLabel: '',
    /** 各板块分类是否有请求进行中（不入渲染，供 isLoading / 防并发使用） */
    requestingByKind: { concept: false, industry: false } as Record<BoardKind, boolean>,
  },

  isLoading() {
    return this.data.requestingByKind[this.data.activeTab]
  },

  /** 页面是否仍为当前展示页（页面栈最后一项）：轮询触发前据此校验 */
  isCurrentPage(): boolean {
    const pages = getCurrentPages()
    const current = pages[pages.length - 1] as WechatMiniprogram.Page.TrivialInstance | undefined
    return current === (this as unknown as WechatMiniprogram.Page.TrivialInstance)
  },

  onLoad() {
    bindTheme(this)
    const cache = cacheByKind[this.data.activeTab]
    if (cache.loaded) {
      // 二次进入：直接复用模块级缓存渲染，再后台静默刷新保鲜
      this.applyCachedToView()
      void this.loadKind(this.data.activeTab, { silent: true })
    } else {
      void this.loadData()
    }
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

  /** 重算当前 tab 展示列表（内存过滤 + 排序，不重新请求） */
  refreshView() {
    const cache = cacheByKind[this.data.activeTab]
    const { query, sortDir } = this.data
    const rows = sortIndustryRows(filterIndustryRows(cache.rawItems, query), sortDir)
    this.setData({ items: rows.map(toView) })
  },

  /** 用当前 tab 的模块级缓存直接渲染列表（成功拉取 / 切 tab / 二次进入共用） */
  applyCachedToView() {
    const cache = cacheByKind[this.data.activeTab]
    this.setData(
      {
        loading: false,
        error: '',
        totalCount: cache.rawItems.length,
        updatedLabel: cache.lastSuccessAt ? buildUpdatedLabel(cache.lastSuccessAt) : '',
      },
      () => this.refreshView(),
    )
  },

  /** 拉取当前 tab 对应的板块分类全量清单（语义见 loadKind） */
  loadData(options?: { silent?: boolean }): Promise<void> {
    return this.loadKind(this.data.activeTab, options)
  },

  /**
   * 拉取指定板块分类的全量清单。
   * - 静默刷新（silent）：不闪 loading，成功原地更新缓存（若仍为当前 tab 则同步视图），
   *   失败保留旧数据；
   * - 常规加载（首屏 / 下拉 / 重试 / 首次切 tab）：展示 loading 与错误态
   *   （仅当该分类仍是当前 tab 时写入页面状态，避免切走后被旧请求覆盖）；
   * - 该分类已有请求进行中直接跳过（防并发）。
   */
  async loadKind(kind: BoardKind, options?: { silent?: boolean }) {
    if (this.data.requestingByKind[kind]) return
    const { silent = false } = options ?? {}
    const meta = KIND_META[kind]
    const isActive = kind === this.data.activeTab
    lastListRequestAt = Date.now()
    this.setData({ requestingByKind: { ...this.data.requestingByKind, [kind]: true } })
    if (isActive && !silent) {
      this.setData({ loading: true, error: '' })
    }
    try {
      const items = await fetchAllBoards(kind)
      const cache = cacheByKind[kind]
      if (!items.length) {
        cache.rawItems = []
        cache.loaded = false
        cache.lastSuccessAt = 0
        if (!silent && isActive) {
          this.setData({ loading: false, error: meta.errorText, items: [], totalCount: 0 })
        }
        return
      }
      cache.rawItems = items
      cache.loaded = true
      cache.lastSuccessAt = Date.now()
      if (isActive) this.applyCachedToView()
    } catch (error) {
      console.warn(`[industry-all] ${meta.label}加载异常:`, error)
      if (!silent && isActive) {
        this.setData({ loading: false, error: meta.errorText, items: [], totalCount: 0 })
      }
    } finally {
      this.setData({ requestingByKind: { ...this.data.requestingByKind, [kind]: false } })
    }
  },

  /** 点击 tab：概念板块 ↔ 行业板块 切换 */
  onTabTap(event: WechatMiniprogram.TouchEvent) {
    const target = event.currentTarget.dataset.kind as BoardKind | undefined
    const meta = target ? KIND_META[target] : undefined
    if (!target || !meta || target === this.data.activeTab) return
    const cache = cacheByKind[target]
    this.setData({
      activeTab: target,
      headerTitle: meta.headerTitle,
      searchPlaceholder: meta.searchPlaceholder,
      countUnit: meta.countUnit,
      loadingText: meta.loadingText,
      loadingDesc: meta.loadingDesc,
      emptyText: meta.emptyText,
      error: '',
    })
    if (cache.loaded) {
      // 已有缓存：即时切换渲染，再后台静默刷新保鲜
      this.applyCachedToView()
      void this.loadKind(target, { silent: true })
    } else {
      // 首次进入该分类：整页 loading 拉取
      void this.loadKind(target)
    }
  },

  onRetry() {
    void this.loadData()
  },

  /** 搜索框输入：名称/代码过滤（内存过滤，作用于当前 tab） */
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
