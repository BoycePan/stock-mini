import { stockApi } from '../../api/stock'
import { getTheme, type ThemeMode } from '../../utils/storage'
import type { StockInfo } from '../../types/stock'

let searchTimer: ReturnType<typeof setTimeout> | null = null

Page({
  data: {
    theme: getTheme() as ThemeMode,
    keyword: '',
    loading: false,
    searched: false,
    results: [] as StockInfo[],
    error: '',
  },
  onShow() {
    this.setData({ theme: getTheme() })
  },
  onUnload() {
    if (searchTimer) clearTimeout(searchTimer)
  },
  onKeywordInput(event: WechatMiniprogram.BaseEvent & { detail: { value: string } }) {
    const keyword = event.detail.value
    this.setData({ keyword })
    if (searchTimer) clearTimeout(searchTimer)
    searchTimer = setTimeout(() => this.doSearch(keyword), 300)
  },
  onSearch() {
    if (searchTimer) clearTimeout(searchTimer)
    this.doSearch(this.data.keyword)
  },
  async doSearch(keyword: string) {
    const q = keyword.trim()
    if (!q) {
      this.setData({ loading: false, searched: false, results: [], error: '' })
      return
    }
    this.setData({ loading: true, error: '' })
    try {
      const result = await stockApi.search(q, 20)
      this.setData({ loading: false, searched: true, results: result.stocks, error: '' })
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
    wx.navigateTo({ url: `/pages/stock-detail/index?code=${stock.code}` })
  },
})
