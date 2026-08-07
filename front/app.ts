import { rootStore } from './stores/root.store'
import { getTheme } from './utils/storage'
import { setLoginWaiter } from './utils/request'

// 所有业务接口发送前都会先等待登录完成（登录接口自身跳过）
setLoginWaiter(() => rootStore.auth.ensureLogin().then(() => undefined))

App({
  globalData: {
    rootStore,
    theme: 'light',
  },
  onLaunch() {
    const theme = getTheme()
    this.globalData.theme = theme
    wx.setNavigationBarColor({
      frontColor: theme === 'dark' ? '#FFFFFF' : '#17191D',
      backgroundColor: theme === 'dark' ? '#151820' : '#F3F6FA',
    })
    // 每次打开小程序自动登录
    rootStore.auth.ensureLogin().then((ok) => {
      if (!ok) {
        console.warn('[auth] 自动登录失败:', rootStore.auth.error || '未知错误')
      }
    })
  },
})
