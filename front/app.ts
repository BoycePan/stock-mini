import { rootStore } from './stores/root.store'
import { getTheme } from './utils/storage'
import { syncWindowBackground } from './utils/theme'
import { setLoginWaiter } from './utils/request'

// 所有业务接口发送前都会先等待登录完成（登录接口自身跳过）
setLoginWaiter(() => rootStore.auth.ensureLogin().then(() => undefined))

App({
  globalData: {
    rootStore,
    theme: 'light',
    themeListenerRegistered: false,
  },
  onLaunch() {
    const theme = getTheme()
    this.globalData.theme = theme
    syncWindowBackground(theme)
    wx.setNavigationBarColor({
      frontColor: theme === 'dark' ? '#FFFFFF' : '#17191D',
      backgroundColor: theme === 'dark' ? '#151820' : '#F3F6FA',
    })
    // 跟随系统模式下，运行期间系统主题变化实时同步到所有存活页面
    // （仅 app.json 配置 darkmode:true 时会触发；手动选过浅色 / 深色的用户不受影响）
    if (wx.onThemeChange && !this.globalData.themeListenerRegistered) {
      this.globalData.themeListenerRegistered = true
      wx.onThemeChange((res) => {
        if (rootStore.settings.themePref === 'system') {
          rootStore.settings.setTheme('system', res.theme)
        }
      })
    }
    // 每次打开小程序自动登录
    rootStore.auth.ensureLogin().then((ok) => {
      if (!ok) {
        console.warn('[auth] 自动登录失败:', rootStore.auth.error || '未知错误')
      }
    })
  },
})
