import { makeAutoObservable, runInAction } from 'mobx-miniprogram'
import { marketApi, type MarketPageKey } from '../api/market'
import type { MarketPageData } from '../types/market'

export class MarketStore {
  pages: Record<MarketPageKey, MarketPageData | null> = {
    global: null,
    asia: null,
    metals: null,
    ai: null,
  }
  loading: Record<MarketPageKey, boolean> = { global: false, asia: false, metals: false, ai: false }
  errors: Record<MarketPageKey, string> = { global: '', asia: '', metals: '', ai: '' }

  constructor() {
    makeAutoObservable(this)
  }

  async loadPage(key: MarketPageKey, force = false) {
    if (this.pages[key] && !force) return this.pages[key]
    this.loading[key] = true
    this.errors[key] = ''
    try {
      const data = await marketApi.getPage(key)
      runInAction(() => {
        this.pages[key] = data
        this.loading[key] = false
      })
      return data
    } catch (error) {
      runInAction(() => {
        this.loading[key] = false
        this.errors[key] = error instanceof Error ? error.message : '数据加载失败'
      })
      throw error
    }
  }
}
