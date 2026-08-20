import { makeAutoObservable } from 'mobx-miniprogram'
import {
  getApiBaseUrl,
  getTheme,
  getThemePreference,
  resolveTheme,
  setApiBaseUrl,
  setTheme,
  type ThemeMode,
  type ThemePreference,
} from '../utils/storage'
import { syncWindowBackground } from '../utils/window'

export class SettingsStore {
  /** 当前实际生效主题（解析后），页面 / 组件绑定链路消费此字段 */
  theme: ThemeMode = getTheme()
  /** 用户主题偏好：'system' 跟随微信客户端主题；'light' / 'dark' 为手动选择 */
  themePref: ThemePreference = getThemePreference()
  apiBaseUrl = getApiBaseUrl()

  constructor() {
    makeAutoObservable(this)
  }

  toggleTheme() {
    this.setTheme(this.theme === 'light' ? 'dark' : 'light')
  }

  /**
   * 设置主题偏好并解析出实际生效主题。
   * - 手动点击浅色 / 深色 → 写入显式偏好，此后不再跟随系统；
   * - 'system' → 跟随微信客户端主题（系统主题变化事件回调时传入 systemTheme，避免二次读取）。
   */
  setTheme(pref: ThemePreference, systemTheme?: ThemeMode) {
    const resolved = resolveTheme(pref, systemTheme)
    this.themePref = pref
    this.theme = resolved
    setTheme(pref, systemTheme)
    // 全局副作用统一收敛在 store 里：任何主题变更都会同步窗口背景与导航栏
    syncWindowBackground(resolved)
    wx.setNavigationBarColor({
      frontColor: resolved === 'dark' ? '#FFFFFF' : '#17191D',
      backgroundColor: resolved === 'dark' ? '#151820' : '#F3F6FA',
    })
  }

  saveApiBaseUrl(url: string) {
    this.apiBaseUrl = url.trim().replace(/\/$/, '')
    setApiBaseUrl(this.apiBaseUrl)
  }

  reset() {
    // 恢复默认：主题回到跟随系统
    this.setTheme('system')
    this.apiBaseUrl = ''
    setApiBaseUrl('')
  }
}
