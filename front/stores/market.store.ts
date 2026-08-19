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
  /**
   * 各页最近一次**真正发起**数据请求的时间戳（毫秒，0 = 从未请求过）。
   * 仅在实际调用 marketApi.getPage 前更新（缓存命中不更新）；
   * 供页面 onShow 判断「距上次请求是否超过 5s」以决定是否立即补刷新（见 utils/auto-refresh.ts）。
   */
  lastRequestAt: Record<MarketPageKey, number> = {
    global: 0,
    asia: 0,
    metals: 0,
    finance: 0,
  }

  constructor() {
    makeAutoObservable(this)
  }

  /**
   * 用本地缓存填充页面数据（缓存优先展示场景）。
   * 仅当 store 中尚无该页数据时调用；调用后页面立即展示缓存，
   * 再通过 loadPage 的 force 参数后台刷新最新数据。
   */
  hydratePage(key: MarketPageKey, data: MarketPageData): void {
    this.pages[key] = data
    this.loading[key] = false
    this.errors[key] = ''
  }

  async loadPage(key: MarketPageKey, options: LoadPageOptions = {}) {
    const { force = false, silent = false } = options
    if (this.pages[key] && !force) return this.pages[key]
    if (!silent) {
      this.loading[key] = true
      this.errors[key] = ''
    }
    try {
      this.lastRequestAt[key] = Date.now()
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
