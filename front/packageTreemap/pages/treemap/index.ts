/**
 * 大盘云图页面（packageTreemap 分包）：
 * - 第一层：行业板块热力图（面积=板块总市值，颜色=板块涨跌幅）
 * - 点击板块 → 钻取第二层：成分股热力图（面积=个股流通市值，颜色=个股涨跌幅）
 * - 点击个股 → 跳转现有 stock-detail 页；板块层点击也可返回行业层
 * - 顶栏指数：上证/深证/创业板/科创50/恒指（东财 ulist 一次请求）
 * - 交易时段每 8 秒轮询刷新当前层（与 52etf 同步率），结构不重建
 * - 内容高度按节点数自适应（chartHeight）：画布为视口大小，超出部分通过
 *   「双指捏合缩放 + 单指拖动平移」（treemap-chart 内实现，带惯性）查看
 * - 双主题兼容（bindTheme）
 */

import { rootStore } from '../../../stores/root.store'
import { bindTheme, unbindTheme } from '../../../utils/theme'
import { trackEvent } from '../../../utils/tracker'
import {
  fetchBoardStocks,
  fetchIndexQuotes,
  fetchIndustryBoards,
  boardsToNodes,
  stocksToNodes,
  summarizeNodes,
} from '../../utils/treemap-data'
import type {
  BoardStock,
  IndustryBoard,
  TreemapIndexQuote,
  TreemapLevel,
  TreemapNode,
} from '../../types/treemap'

/** 轮询间隔（与 52etf 一致：交易时段 8 秒） */
const POLL_INTERVAL = 8000

/** 画布最小格子边长（CSS px），决定内容超出时的高度，保证可读 */
const MIN_CELL = 30

interface TreemapPageData {
  theme: string
  loading: boolean
  error: string
  emptyText: string
  level: TreemapLevel
  indices: Array<TreemapIndexQuote & { priceText: string; pctText: string; pct: number }>
  nodes: TreemapNode[]
  currentBoardName: string
  currentBoard: IndustryBoard | null
  summary: { up: number; flat: number; down: number; amountText: string }
  updatedText: string
  /** 内容高度（CSS px，树图布局区高度，超出视口由图表缩放/拖动查看） */
  chartHeight: number
  /** 图表可视区高度（CSS px，onReady 测量） */
  chartViewportH: number
}

Page({
  data: {
    theme: rootStore.settings.theme,
    loading: true,
    error: '',
    emptyText: '',
    level: 'industry' as TreemapLevel,
    indices: [] as TreemapPageData['indices'],
    nodes: [] as TreemapNode[],
    currentBoardName: '',
    currentBoard: null as IndustryBoard | null,
    summary: { up: 0, flat: 0, down: 0, amountText: '' },
    updatedText: '',
    chartHeight: 0,
    chartViewportH: 0,
  },

  /** 轮询定时器 */
  _timer: null as ReturnType<typeof setInterval> | null,
  /** 页面可见性（onHide 暂停轮询） */
  _visible: true,

  onLoad() {
    bindTheme(this)
    this.loadInitial()
  },
  onReady() {
    this.measureChartArea()
  },
  onShow() {
    this._visible = true
    this.startPolling()
  },
  onHide() {
    this._visible = false
    this.stopPolling()
  },
  onUnload() {
    this.stopPolling()
    unbindTheme(this)
  },

  // -------------------------------------------------------------------------
  // 数据加载
  // -------------------------------------------------------------------------

  async loadInitial() {
    this.setData({ loading: true, error: '' })
    try {
      const [indices, boards] = await Promise.all([fetchIndexQuotes(), fetchIndustryBoards()])
      if (!boards.length) throw new Error('板块数据为空')
      const nodes = boardsToNodes(boards)
      this.setData({
        indices: indices.map((item) => this.indexView(item)),
        nodes,
        chartHeight: this.chartHeightFor(nodes.length),
        level: 'industry',
        currentBoardName: '',
        currentBoard: null,
        loading: false,
      })
      this.applySummary(nodes)
      // 成功加载后恢复轮询（onLoad 首次 / 钻取返回 / 重试均走这里，幂等）
      this.startPolling()
    } catch (error) {
      console.warn('[treemap] 初始加载失败:', error)
      this.setData({
        loading: false,
        error: '加载失败，请检查网络后重试',
        emptyText: '暂无板块数据',
      })
    }
  },

  onRetry() {
    this.loadInitial()
  },

  /** 钻取到板块成分股 */
  async onSelect(event: WechatMiniprogram.CustomEvent<{ node: TreemapNode }>) {
    const node = event.detail?.node
    if (!node) return
    if (this.data.level === 'industry') {
      this.drillInto(node)
    } else {
      this.openStock(node)
    }
  },

  async drillInto(node: TreemapNode) {
    const board = node.raw as IndustryBoard | undefined
    if (!board) return
    trackEvent('treemap.drill', board.code)
    this.setData({ loading: true, error: '' })
    try {
      const stocks = await fetchBoardStocks(board.code)
      if (!stocks.length) throw new Error('板块成分股为空')
      const nodes = stocksToNodes(stocks)
      this.setData({
        nodes,
        chartHeight: this.chartHeightFor(nodes.length),
        level: 'stock',
        currentBoardName: board.name,
        currentBoard: board,
        loading: false,
      })
      this.applySummary(nodes)
    } catch (error) {
      console.warn(`[treemap] 板块 ${board.code} 成分股加载失败:`, error)
      this.setData({ loading: false, error: '板块成分股加载失败，请重试' })
    }
  },

  onBackToIndustry() {
    // 返回行业层：重新拉板块列表并恢复轮询（loadInitial 内部会 startPolling）
    this.loadInitial()
    trackEvent('treemap.back')
  },

  openStock(node: TreemapNode) {
    const stock = node.raw as BoardStock | undefined
    if (!stock) return
    trackEvent('treemap.stock', stock.code)
    wx.navigateTo({
      url: `/packageQuote/pages/stock-detail/index?code=${stock.code}`,
      fail: () => {
        wx.showToast({ title: '跳转失败', icon: 'none' })
      },
    })
  },

  // -------------------------------------------------------------------------
  // 8s 轮询（仅交易时段内有效刷新，页面不可见时暂停）
  // -------------------------------------------------------------------------

  startPolling() {
    this.stopPolling()
    this._timer = setInterval(() => {
      if (!this._visible || this.data.loading) return
      this.refreshCurrentLevel()
    }, POLL_INTERVAL)
  },
  stopPolling() {
    if (this._timer) {
      clearInterval(this._timer)
      this._timer = null
    }
  },

  /** 刷新当前层：行业层重新拉板块列表（带缓存校验），个股层重新拉成分股 */
  async refreshCurrentLevel() {
    try {
      let nodes: TreemapNode[] | null = null
      if (this.data.level === 'industry') {
        const boards = await fetchIndustryBoards(true)
        if (!boards.length) return
        nodes = boardsToNodes(boards)
      } else {
        const board = this.data.currentBoard
        if (!board) return
        const stocks = await fetchBoardStocks(board.code)
        if (!stocks.length) return
        nodes = stocksToNodes(stocks)
      }
      if (nodes) {
        this.setData({ nodes, chartHeight: this.chartHeightFor(nodes.length) })
        this.applySummary(nodes)
      }
      // 指数也一起刷新（轻量）
      const indices = await fetchIndexQuotes()
      this.setData({ indices: indices.map((item) => this.indexView(item)) })
    } catch (error) {
      console.warn('[treemap] 轮询刷新失败:', error)
    }
  },

  // -------------------------------------------------------------------------
  // 视图组装
  // -------------------------------------------------------------------------

  indexView(item: TreemapIndexQuote): TreemapPageData['indices'][number] {
    return {
      ...item,
      pct: item.pct ?? 0,
      priceText: item.price === null ? '--' : item.price.toFixed(2),
      pctText: item.pct === null ? '--' : `${item.pct > 0 ? '+' : ''}${item.pct.toFixed(2)}%`,
    }
  },

  applySummary(nodes: TreemapNode[]) {
    const { up, down, flat, amount } = summarizeNodes(nodes)
    const amountText =
      amount >= 1e12
        ? `${(amount / 1e12).toFixed(2)}万亿`
        : amount >= 1e8
          ? `${(amount / 1e8).toFixed(0)}亿`
          : amount > 0
            ? `${(amount / 1e4).toFixed(0)}万`
            : '--'
    const now = new Date()
    const hh = String(now.getHours()).padStart(2, '0')
    const mm = String(now.getMinutes()).padStart(2, '0')
    const ss = String(now.getSeconds()).padStart(2, '0')
    this.setData({ summary: { up, down, flat, amountText }, updatedText: `${hh}:${mm}:${ss}` })
  },

  // -------------------------------------------------------------------------
  // 内容高度（节点多时超出视口，由 treemap-chart 缩放/拖动查看）
  // -------------------------------------------------------------------------

  /** 测量图表可视区高度，用于「内容少时填满、内容多时给出超屏内容高度」 */
  measureChartArea() {
    wx.createSelectorQuery()
      .select('.chart-wrap')
      .boundingClientRect((rect) => {
        if (rect && rect.height > 0) {
          this.setData({ chartViewportH: rect.height })
          this.setData({ chartHeight: this.chartHeightFor(this.data.nodes.length) })
        }
      })
      .exec()
  },

  /**
   * 计算内容高度（CSS px）：
   * 节点少时用可视区高度填满正屏；节点多时按「节点数 / 每行格子数 × 格子边长」给出
   * 超屏内容高度，树图布局区高 = max(可视区高, rows×MIN_CELL)，超出视口的部分
   * 由 treemap-chart 的缩放/拖动查看（无需页面滚动），块不会挤成细条。
   */
  chartHeightFor(nodeCount: number): number {
    const info = wx.getWindowInfo()
    const windowW = info.windowWidth || 375
    // 图表左右各 24rpx padding
    const chartW = Math.max(120, windowW - (24 / 750) * windowW * 2)
    const viewportH = this.data.chartViewportH || Math.round((info.windowHeight || 812) * 0.5)
    if (nodeCount <= 0) return Math.max(400, viewportH)
    const cols = Math.max(1, Math.floor(chartW / MIN_CELL))
    const rows = Math.ceil(nodeCount / cols)
    return Math.max(Math.round(viewportH), rows * MIN_CELL)
  },
})
