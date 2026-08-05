import { rootStore } from './stores/root.store'
import { getTheme, setTheme } from './utils/storage'

App({
  globalData: {
    rootStore,
  },
  onLaunch() {
    const theme = getTheme()
    setTheme(theme)
    wx.setNavigationBarColor({
      frontColor: theme === 'dark' ? '#FFFFFF' : '#17191D',
      backgroundColor: theme === 'dark' ? '#151820' : '#F3F6FA',
    })
  },
})
