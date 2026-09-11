import { makeAutoObservable, runInAction } from 'mobx-miniprogram'
import { authApi } from '../api/auth'
import type { LoginResult, User } from '../types/user'
import { clearToken, clearUser, getToken, getUser, setToken, setUser } from '../utils/storage'
import { trackEvent } from '../utils/tracker'

// 本次会话的登录 Promise：成功后会复用，失败则清空允许下次重试（模块级，避免被 mobx 观测）
let loginPromise: Promise<LoginResult | null> | null = null

// logout 的附加失效动作（模块级，避免被 mobx 观测）。
// 由 RootStore 构造时通过 setLogoutHook 注册：AuthStore 不能 import root.store（会形成环依赖），
// 反向注册既保持依赖方向，又让调用方 rootStore.auth.logout() 一步到位（无需改调用方）。
let logoutHook: (() => void) | null = null

/** 注册 logout 的附加失效动作；传 null 取消注册 */
export function setLogoutHook(hook: (() => void) | null): void {
  logoutHook = hook
}

export class AuthStore {
  token = getToken()
  user: User | null = getUser<User>()
  loading = false
  error = ''

  constructor() {
    makeAutoObservable(this)
  }

  get isLoggedIn() {
    return Boolean(this.token)
  }

  /**
   * 确保本次会话只并发执行一次登录；始终返回登录结果（失败时返回 null）。
   * 请求层经 rootStore.bootstrap 在每个接口发送前 await 该 Promise；
   * 登录失败时返回 null 并清空缓存，允许后续请求重试登录。
   */
  ensureLogin(): Promise<LoginResult | null> {
    if (!loginPromise) {
      loginPromise = this.login()
        .then((result) => result)
        .catch(() => {
          loginPromise = null
          return null
        })
    }
    return loginPromise
  }

  async login() {
    this.loading = true
    this.error = ''
    try {
      const code = await new Promise<string>((resolve, reject) => {
        wx.login({
          success: (result) => resolve(result.code),
          fail: reject,
        })
      })
      const result = await authApi.login(code)
      runInAction(() => {
        this.token = result.token
        this.user = result.user
        this.loading = false
      })
      setToken(result.token)
      setUser(result.user)
      trackEvent('login.action')
      return result
    } catch (error) {
      runInAction(() => {
        this.loading = false
        this.error = error instanceof Error ? error.message : '登录失败'
      })
      throw error
    }
  }

  logout() {
    this.reset()
    clearToken()
    clearUser()
    // 清空会话登录 Promise，允许下一次请求（ensureLogin）重新登录
    loginPromise = null
    // 使全局就绪失效（RootStore 注册的回调，见 root.store.ts invalidateBootstrap）：
    // 只清 token 与 loginPromise 不够——旧 bootstrapPromise 已 resolve 且会被复用，
    // reLaunch 后新页面首个业务请求 await 到它就直接放行，ensureLogin() 不会被调用，
    // 于是带着已被清空的 Storage token 发请求（真机表现为 401），
    // 只能等埋点定时 flush 的登录门闩在约 10s 后「自愈」，可靠性不足。
    logoutHook?.()
  }

  reset() {
    this.token = ''
    this.user = null
    this.loading = false
    this.error = ''
  }

  setUser(user: User | null) {
    this.user = user
    if (user) setUser(user)
  }
}
