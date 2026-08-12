import { stockApi } from '../../api/stock'
import { rootStore } from '../../stores/root.store'
import { addSearchHistory, clearSearchHistory, getSearchHistory } from '../../utils/storage'
import type { StockInfo } from '../../types/stock'
import { bindTheme, unbindTheme } from '../../utils/theme'

let searchTimer: ReturnType<typeof setTimeout> | null = null

Page({
  data: {
    theme: rootStore.settings.theme,
    keyword: '',
    loading: false,
    searched: false,
    results: [] as StockInfo[],
    error: '',
    history: [] as string[],
  },
  onLoad() {
    bindTheme(this)
    this.setData({ history: getSearchHistory() })
  },
  onUnload() {
    if (searchTimer) clearTimeout(searchTimer)
    unbindTheme(this)
  },
  onKeywordInput(event: WechatMiniprogram.BaseEvent & { detail: { value: string } }) {
    const keyword = event.detail.value
    this.setData({ keyword })
    if (searchTimer) clearTimeout(searchTimer)
    searchTimer = setTimeout(() => this.doSearch(keyword), 300)
  },
  onSearch() {
    if (searchTimer) clearTimeout(searchTimer)
    this.doSearch(this.data.keyword, true)
  },
  async doSearch(keyword: string, record = false) {
    const q = keyword.trim()
    if (!q) {
      this.setData({ loading: false, searched: false, results: [], error: '' })
      return
    }
    this.setData({ loading: true, error: '' })
    try {
      const result = await stockApi.search(q, 20)
      this.setData({ loading: false, searched: true, results: result.stocks, error: '' })
      if (record) this.recordHistory(q)
    } catch (error) {
      this.setData({
        loading: false,
        searched: true,
        results: [],
        error: error instanceof Error ? error.message : '搜索失败',
      })
    }
  },
  onResultTap(event: WechatMiniprogram.BaseEvent) {
    const index = (event.currentTarget as unknown as { dataset: { index?: number } }).dataset.index
    if (index === undefined) return
    const stock = this.data.results[index]
    if (!stock) return
    this.recordHistory(this.data.keyword)
    wx.navigateTo({ url: `/pages/stock-detail/index?code=${stock.code}` })
  },

  recordHistory(keyword: string) {
    this.setData({ history: addSearchHistory(keyword) })
  },
  onHistoryTap(event: WechatMiniprogram.BaseEvent) {
    const index = (event.currentTarget as unknown as { dataset: { index?: number } }).dataset.index
    if (index === undefined) return
    const keyword = this.data.history[index]
    if (!keyword) return
    this.recordHistory(keyword)
    this.setData({ keyword, searched: false, results: [], error: '' })
    if (searchTimer) clearTimeout(searchTimer)
    this.doSearch(keyword)
  },
  onClearHistory() {
    clearSearchHistory()
    this.setData({ history: [] })
  },
})
