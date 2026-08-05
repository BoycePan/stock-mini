import { makeAutoObservable, runInAction } from 'mobx-miniprogram'
import { authApi } from '../api/auth'
import type { User } from '../types/user'
import { clearToken, clearUser, getToken, getUser, setToken, setUser } from '../utils/storage'

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
