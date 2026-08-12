import { makeAutoObservable, runInAction } from 'mobx-miniprogram'
import { marketApi, type MarketPageKey } from '../api/market'
import type { MarketPageData } from '../types/market'

export interface LoadPageOptions {
  /** 强制重新拉取（下拉刷新 / 错误重试）；默认命中缓存 */
  force?: boolean
  /** 静默刷新：不展示 loading、失败时不覆盖已有错误信息（自动刷新场景） */
  silent?: boolean
}

export class MarketStore {
  pages: Record<MarketPageKey, MarketPageData | null> = {
    global: null,
    asia: null,
    metals: null,
    finance: null,
  }
  loading: Record<MarketPageKey, boolean> = {
    global: false,
    asia: false,
    metals: false,
    finance: false,
  }
  errors: Record<MarketPageKey, string> = { global: '', asia: '', metals: '', finance: '' }

  constructor() {
    makeAutoObservable(this)
  }

  async loadPage(key: MarketPageKey, options: LoadPageOptions = {}) {
    const { force = false, silent = false } = options
    if (this.pages[key] && !force) return this.pages[key]
    if (!silent) {
      this.loading[key] = true
      this.errors[key] = ''
    }
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
        if (!silent) {
          this.errors[key] = error instanceof Error ? error.message : '数据加载失败'
        }
      })
      throw error
    }
  }
}
