import { rootStore } from './stores/root.store'
import { getTheme } from './utils/storage'
import { syncWindowBackground } from './utils/theme'
import { setLoginWaiter } from './utils/request'
import {
  flush,
  initTracker,
  onAppHide,
  onAppShow,
  setTrackingLoginWaiter,
  startFlushTimer,
} from './utils/tracker'

// 所有业务接口发送前都会先等待登录完成（登录接口自身跳过）
setLoginWaiter(() => rootStore.auth.ensureLogin().then(() => undefined))
// 打点只在登录成功后才上报：flush 前 await 登录成功，失败则事件留队等下次重试（绝不匿名上报）
setTrackingLoginWaiter(() => rootStore.auth.ensureLogin())

App({
  globalData: {
    rootStore,
    theme: 'light',
    themeListenerRegistered: false,
  },
  onLaunch() {
    // 打点：注册全局路由监听（自动 page.view / page.hide）+ 启动攒批定时上报
    initTracker()
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
      if (ok) {
        startFlushTimer()
      } else {
        console.warn('[auth] 自动登录失败:', rootStore.auth.error || '未知错误')
      }
    })
  },
  onShow() {
    // 打点：冷启动兜底补发首个 page.view（路由事件可能晚于 onShow）；后台返回时补发新一次 page.view
    onAppShow()
  },
  onHide() {
    // 打点：结算当前页停留（page.hide + durationMs）并尽量在退后台前上报
    onAppHide()
  },
  onError() {
    // 打点：出错时把队列里的事件尽量上报（最多丢最近几秒）
    void flush()
  },
})
