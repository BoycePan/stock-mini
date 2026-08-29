import { AuthStore } from './auth.store'
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
