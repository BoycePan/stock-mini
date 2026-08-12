import { makeAutoObservable } from 'mobx-miniprogram'
import {
  getApiBaseUrl,
  getMockFallback,
  getTheme,
  setApiBaseUrl,
  setMockFallback,
  setTheme,
  type ThemeMode,
} from '../utils/storage'

export class SettingsStore {
  theme: ThemeMode = getTheme()
  apiBaseUrl = getApiBaseUrl()
  useMockFallback = getMockFallback()

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

  setMockFallback(enabled: boolean) {
    this.useMockFallback = enabled
    setMockFallback(enabled)
  }

  reset() {
    this.theme = 'light'
    this.apiBaseUrl = ''
    this.useMockFallback = true
    setTheme('light')
    setApiBaseUrl('')
    setMockFallback(true)
    wx.setNavigationBarColor({
      frontColor: '#17191D',
      backgroundColor: '#F3F6FA',
    })
  }
}
