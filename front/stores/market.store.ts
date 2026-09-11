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

  /**
   * 各页「已发起请求」的递增序号：只有序号等于最新值的请求可以落库。
   * force（用户主动刷新）与在途静默轮询会并行存在（见 loadPage 的 force 例外），
   * 无序号保护时后返回的旧响应会覆盖新数据；这里保证「最新一次发起者胜出」。
   * 内部字段，已通过 makeAutoObservable overrides 排除可观察性。
   */
  requestSeq: Record<MarketPageKey, number> = { global: 0, asia: 0, metals: 0, finance: 0 }

  constructor() {
    makeAutoObservable(this, { inFlight: false, requestSeq: false })
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
    // 例外：force（用户主动下拉刷新 / 重试）不复用静默轮询的在途请求——该请求以
    // silent=true 创建，失败不写 errors，复用它会让调用方误判为「刷新成功」，
    // 用户看到「已更新」但数据其实没刷新失败。此时直接并行发起一次强制请求，
    // 两者并行时的落库顺序由 requestSeq 保证（最新一次发起者胜出）。
    const inFlight = this.inFlight[key]
    if (inFlight && !force) return inFlight
    if (!silent) {
      this.loading[key] = true
      this.errors[key] = ''
    }
    const seq = ++this.requestSeq[key]
    const promise = this.requestPage(key, silent, seq)
    // 本请求开始时无在途请求（或本就无在途）时登记它，保证并发调用（含静默轮询）仍去重；
    // 已有在途静默请求时保留原登记，force 请求不被后续静默轮询复用
    if (!inFlight) this.inFlight[key] = promise
    try {
      return await promise
    } finally {
      if (this.inFlight[key] === promise) delete this.inFlight[key]
    }
  }

  /**
   * 真正发起外部请求并落库（被 loadPage 包裹：并发去重 + loading/错误状态）。
   * seq 为本次请求的序号：只有仍是「最新一次发起」时才写 pages/loading/errors，
   * 避免 force 与在途静默请求并行时，先发起的旧响应后返回并覆盖新数据。
   */
  async requestPage(key: MarketPageKey, silent: boolean, seq: number): Promise<MarketPageData> {
    this.lastRequestAt[key] = Date.now()
    try {
      const data = await marketApi.getPage(key)
      runInAction(() => {
        // 已被更晚的请求取代：本次结果过期，不落库（不再覆盖新数据）
        if (seq !== this.requestSeq[key]) return
        this.pages[key] = data
        this.loading[key] = false
        // 成功即清空错误态：errors 只在非静默请求开始时清空，若此处不清，一次失败后
        // 静默自动刷新即使成功拿到新数据，页面模板的 `wx:elif="{{error}}"` 仍会整页
        // 显示「重新加载」而挡住新数据，只能靠用户手动再刷一次才恢复。
        this.errors[key] = ''
      })
      return data
    } catch (error) {
      runInAction(() => {
        // 过期请求的失败不再干扰最新请求的状态（loading 由最新一次请求负责复位）
        if (seq !== this.requestSeq[key]) return
        this.loading[key] = false
        if (!silent) {
          this.errors[key] = error instanceof Error ? error.message : '数据加载失败'
        }
      })
      throw error
    }
  }
}
