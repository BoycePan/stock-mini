import { makeAutoObservable, runInAction } from 'mobx-miniprogram'
import { systemApi } from '../api/system'
import type { AppConfig, Notice, PopupNotice } from '../types/system'
import { resolveHomePopupNotice } from '../utils/popup-notice'

/**
 * 系统配置与公告全局 store（docs/API.md 八）。
 *
 * - loginConfig：cfg_type='login' 的配置，跟随登录接口下发，登录后即用；
 * - configs：cfg_type='display' 的前端展示配置，随全局就绪流程拉取；
 * - notices：当前端全部有效公告，页面按 position 过滤使用。
 *
 * 拉取由 rootStore.bootstrap 编排（登录成功后执行）。两路各自降级（Promise.allSettled）：
 * 成功的一路写回，失败的一路保留旧值并记录 error；display 配置成功即 ready=true，
 * 配置失败则 ready 保持 false 且不阻塞业务接口，下次请求会重新走一遍就绪流程。
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

  /**
   * 首页弹窗公告（position='home' 的 notice 映射为 PopupNotice，
   * 见 utils/popup-notice.ts resolveHomePopupNotice）；无合法 home 公告时 null（不弹）。
   * 首页通过行情页工厂的 popupNotice 响应式 getter 读取，公告拉取到达时即时出现。
   */
  get homePopupNotice(): PopupNotice | null {
    return resolveHomePopupNotice(this.notices)?.popup ?? null
  }

  /** 首页弹窗展示状态缓存键（按公告 id 区分，组件 storageKey）；无 home 公告时回退组件默认键 */
  get homePopupStorageKey(): string {
    return resolveHomePopupNotice(this.notices)?.storageKey ?? 'popup_notice_state'
  }

  /** 拉取 display 配置 + 公告（在 rootStore.bootstrap 内、登录成功后调用） */
  async fetchAll(): Promise<void> {
    this.loading = true
    try {
      // allSettled 而非 all：display 配置与公告是两条彼此独立的链路，Promise.all 下任一失败
      // 会让整体 reject —— 已成功取到的 display 配置被一起丢弃（回退默认值）、ready 保持 false，
      // 之后每次业务请求都要重跑一遍就绪流程。改为各自降级：成功的写回，失败的保留旧值并记录 error。
      const [configsResult, noticesResult] = await Promise.allSettled([
        systemApi.configs('display'),
        systemApi.notices(),
      ])
      const failures: string[] = []
      if (configsResult.status === 'rejected') {
        failures.push(reasonText(configsResult.reason, '展示配置'))
      }
      if (noticesResult.status === 'rejected') {
        failures.push(reasonText(noticesResult.reason, '公告'))
      }

      runInAction(() => {
        // 失败的那一路保留旧值：瞬时失败不应把页面上已在用的配置 / 公告清空
        if (configsResult.status === 'fulfilled') this.configs = configsResult.value ?? {}
        if (noticesResult.status === 'fulfilled') this.notices = noticesResult.value ?? []
        this.error = failures.join('；')
        // ready 判定依据 = display 配置是否取到：它是业务页面渲染直接依赖的必需数据，
        // 公告只是可选展示（拉不到最多不弹公告，不影响任何页面渲染）。
        // 因此配置成功即视为「配置已就绪」，公告失败不改 ready；
        // 配置失败则保持 false（不清掉旧的 true），下一次业务请求会重跑就绪流程。
        if (configsResult.status === 'fulfilled') this.ready = true
      })
    } catch (error) {
      // 兜底：allSettled 不会 reject，但两个 api 调用若在参数求值时同步抛错仍会走到这里
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

/** 降级错误文案：失败原因可能是 Error、字符串或任意抛出值 */
function reasonText(reason: unknown, label: string): string {
  const detail = reason instanceof Error ? reason.message : String(reason)
  return `${label}拉取失败：${detail}`
}
