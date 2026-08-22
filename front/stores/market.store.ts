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
  /**
   * 各页进行中的数据请求（含静默刷新）Promise，用于并发去重：
   * 同一页已有请求在途时（首屏 / 10s 轮询 / onShow 补刷 / 下拉刷新），
   * 后续 loadPage 直接复用该 Promise，不再重复发请求——慢网络下防止请求堆积
   * （silent 请求不置 loading，仅靠 loading 标志无法拦住并发）。
   * 内部字段（勿在外部读写）：已通过 makeAutoObservable overrides 排除可观察性，
   * 不参与 MobX 追踪。
   */
  inFlight: Partial<Record<MarketPageKey, Promise<MarketPageData>>> = {}

  constructor() {
    makeAutoObservable(this, { inFlight: false })
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
    // 并发去重：同 key 已有请求在途（含静默轮询 / onShow 补刷）时复用同一请求，
    // 不重复发接口；请求结束后才允许下一个请求开始。
    const inFlight = this.inFlight[key]
    if (inFlight) return inFlight
    if (!silent) {
      this.loading[key] = true
      this.errors[key] = ''
    }
    const promise = this.requestPage(key, silent)
    this.inFlight[key] = promise
    try {
      return await promise
    } finally {
      if (this.inFlight[key] === promise) delete this.inFlight[key]
    }
  }

  /** 真正发起外部请求并落库（被 loadPage 包裹：并发去重 + loading/错误状态） */
  async requestPage(key: MarketPageKey, silent: boolean): Promise<MarketPageData> {
    this.lastRequestAt[key] = Date.now()
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
