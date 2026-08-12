import { makeAutoObservable } from 'mobx-miniprogram'
import { getTheme, setTheme, type ThemeMode } from '../utils/storage'

export class SettingsStore {
  theme: ThemeMode = getTheme()

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

  reset() {
    this.theme = 'light'
    wx.setNavigationBarColor({
      frontColor: '#17191D',
      backgroundColor: '#F3F6FA',
    })
  }
}
