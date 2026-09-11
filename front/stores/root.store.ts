import { runInAction } from 'mobx-miniprogram'
import { AuthStore, setLogoutHook } from './auth.store'
import { MarketStore } from './market.store'
import { SettingsStore } from './settings.store'
import { SystemStore } from './system.store'

export class RootStore {
  auth = new AuthStore()
  market = new MarketStore()
  settings = new SettingsStore()
  system = new SystemStore()

  /** 全局就绪编排的单例 Promise（内部字段，不参与 MobX 观测） */
  private bootstrapPromise: Promise<void> | null = null

  constructor() {
    // 退出登录必须让全局就绪失效：反向注册回调，避免 auth.store → root.store 的环依赖
    // （auth.store 只持有回调，不知道 RootStore 的存在）
    setLogoutHook(() => this.invalidateBootstrap())
  }

  /**
   * 全局就绪门闩：登录 → 系统配置（login 配置 + display 配置 + 公告）。
   * 由 app.ts 注册到请求层，所有业务接口发送前都会 await 它，
   * 保证「登录与配置都就绪后，授权接口才被调用」。
   * 登录或配置失败时不缓存结果，下一次接口请求会重新走一遍就绪流程。
   */
  bootstrap(): Promise<void> {
    if (!this.bootstrapPromise) {
      this.bootstrapPromise = this.bootstrapImpl().finally(() => {
        if (!this.system.ready) this.bootstrapPromise = null
      })
    }
    return this.bootstrapPromise
  }

  /**
   * 使全局就绪失效：清掉已 resolve 的 bootstrapPromise，下一次业务请求会完整重跑
   * 「ensureLogin + fetchAll」。
   * 触发条件：退出登录（AuthStore.logout 通过 setLogoutHook 调用）。
   * 后果（不调用时）：旧就绪 Promise 仍被复用 → 新页面首个业务请求不会重新登录，
   * 带着已清空的 token 发出（401），要等埋点定时 flush 的登录门闩约 10s 后才自愈。
   * system.ready 一并复位：它的语义是「当前会话的配置已就绪」，登出后登录配置与展示配置
   * 都需要重新拉取；复位后 bootstrapImpl 的 finally 也会在失败时保持「不缓存、下次重试」。
   */
  invalidateBootstrap(): void {
    this.bootstrapPromise = null
    // system.ready 是 MobX observable（makeAutoObservable），在 action 内改动，
    // 避免被其它绑定观测时触发 enforceActions 告警
    runInAction(() => {
      this.system.ready = false
    })
  }

  private async bootstrapImpl(): Promise<void> {
    const loginResult = await this.auth.ensureLogin()
    if (loginResult) {
      this.system.applyLoginConfig(loginResult.config)
    }
    // 配置拉取内部降级（失败记录 error、不抛错）；登录失败时此处也会 401 降级
    await this.system.fetchAll()
  }
}

export const rootStore = new RootStore()
