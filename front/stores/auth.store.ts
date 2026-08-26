import { makeAutoObservable, runInAction } from 'mobx-miniprogram'
import { authApi } from '../api/auth'
import type { User } from '../types/user'
import { clearToken, clearUser, getToken, getUser, setToken, setUser } from '../utils/storage'
import { trackEvent } from '../utils/tracker'

// 本次会话的登录 Promise：成功后会复用，失败则清空允许下次重试（模块级，避免被 mobx 观测）
let loginPromise: Promise<boolean> | null = null

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
   * 确保本次会话只并发执行一次登录；始终返回是否登录成功。
   * 请求层会在每个接口发送前 await 该 Promise，登录失败时返回 false
   * 并清空缓存，允许后续请求重试登录。
   */
  ensureLogin(): Promise<boolean> {
    if (!loginPromise) {
      loginPromise = this.login()
        .then(() => true)
        .catch(() => {
          loginPromise = null
          return false
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
