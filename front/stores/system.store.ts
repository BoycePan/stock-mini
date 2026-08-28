import { makeAutoObservable, runInAction } from 'mobx-miniprogram'
import { systemApi } from '../api/system'
import type { AppConfig, Notice } from '../types/system'

/**
 * 系统配置与公告全局 store（docs/API.md 八）。
 *
 * - loginConfig：cfg_type='login' 的配置，跟随登录接口下发，登录后即用；
 * - configs：cfg_type='display' 的前端展示配置，随全局就绪流程拉取；
 * - notices：当前端全部有效公告，页面按 position 过滤使用。
 *
 * 拉取由 rootStore.bootstrap 编排（登录成功后执行）。失败时静默降级：
 * 保留空数据并记录 error、ready 保持 false，不阻塞业务接口，
 * 下次请求会重新走一遍就绪流程。
 */
export class SystemStore {
  loginConfig: AppConfig = {}
  configs: AppConfig = {}
  notices: Notice[] = []
  /** 登录 + 系统配置是否已就绪 */
  ready = false
  loading = false
  error = ''

  constructor() {
    makeAutoObservable(this)
  }

  applyLoginConfig(config?: AppConfig) {
    this.loginConfig = config ?? {}
  }

  /** 设置页公告（position='settings'） */
  get settingsNotices() {
    return this.notices.filter((n) => n.position === 'settings')
  }

  /** 拉取 display 配置 + 公告（在 rootStore.bootstrap 内、登录成功后调用） */
  async fetchAll(): Promise<void> {
    this.loading = true
    try {
      const [configs, notices] = await Promise.all([
        systemApi.configs('display'),
        systemApi.notices(),
      ])
      runInAction(() => {
        this.configs = configs ?? {}
        this.notices = notices ?? []
        this.error = ''
        this.ready = true
      })
    } catch (error) {
      runInAction(() => {
        this.error = error instanceof Error ? error.message : '系统配置拉取失败'
      })
    } finally {
      runInAction(() => {
        this.loading = false
      })
    }
  }
}
