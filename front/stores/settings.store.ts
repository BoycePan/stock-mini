import { makeAutoObservable } from 'mobx-miniprogram'
import { getApiBaseUrl, getTheme, setApiBaseUrl, setTheme, type ThemeMode } from '../utils/storage'
import { syncWindowBackground } from '../utils/window'

export class SettingsStore {
  theme: ThemeMode = getTheme()
  apiBaseUrl = getApiBaseUrl()

  constructor() {
    makeAutoObservable(this)
  }

  toggleTheme() {
    this.setTheme(this.theme === 'light' ? 'dark' : 'light')
  }

  setTheme(theme: ThemeMode) {
    this.theme = theme
    setTheme(theme)
    // 全局副作用统一收敛在 store 里：任何页面切换主题都会同步窗口背景与导航栏
    syncWindowBackground(theme)
    wx.setNavigationBarColor({
      frontColor: theme === 'dark' ? '#FFFFFF' : '#17191D',
      backgroundColor: theme === 'dark' ? '#151820' : '#F3F6FA',
    })
  }

  saveApiBaseUrl(url: string) {
    this.apiBaseUrl = url.trim().replace(/\/$/, '')
    setApiBaseUrl(this.apiBaseUrl)
  }

  reset() {
    this.theme = 'light'
    this.apiBaseUrl = ''
    setTheme('light')
    setApiBaseUrl('')
    syncWindowBackground('light')
    wx.setNavigationBarColor({
      frontColor: '#17191D',
      backgroundColor: '#F3F6FA',
    })
  }
}
