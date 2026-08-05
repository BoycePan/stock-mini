import { makeAutoObservable } from 'mobx-miniprogram'
import { getApiBaseUrl, getTheme, setApiBaseUrl, setTheme, type ThemeMode } from '../utils/storage'

export class SettingsStore {
  theme: ThemeMode = getTheme()
  apiBaseUrl = getApiBaseUrl()
  useMockFallback = true

  constructor() {
    makeAutoObservable(this)
  }

  toggleTheme() {
    this.setTheme(this.theme === 'light' ? 'dark' : 'light')
  }

  setTheme(theme: ThemeMode) {
    this.theme = theme
    setTheme(theme)
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
    this.useMockFallback = true
    wx.setNavigationBarColor({
      frontColor: '#17191D',
      backgroundColor: '#F3F6FA',
    })
  }
}
