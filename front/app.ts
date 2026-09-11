import { rootStore } from './stores/root.store'
import { getTheme } from './utils/storage'
import { syncWindowBackground } from './utils/theme'
import { setReadyWaiter } from './utils/request'
import {
  flush,
  initTracker,
  onAppHide,
  onAppShow,
  setTrackingLoginWaiter,
  startFlushTimer,
} from './utils/tracker'

// 所有业务接口发送前都会等待「登录 + 系统配置」就绪（登录 / 系统配置接口自身跳过）
setReadyWaiter(() => rootStore.bootstrap())
// 打点只在登录成功后才上报：flush 前 await 登录成功，失败则事件留队等下次重试（绝不匿名上报）
setTrackingLoginWaiter(() => rootStore.auth.ensureLogin().then((result) => Boolean(result)))

App({
  globalData: {
    rootStore,
    theme: 'light',
    themeListenerRegistered: false,
  },
  onLaunch() {
    // 打点：注册全局路由监听（自动 page.view / page.hide）；攒批定时上报在下方无条件启动
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
    // 打点定时上报：无条件启动（startFlushTimer 内部幂等），不依赖登录结果——
    // 冷启动登录接口失败（离线 / 后端异常）时，若只在登录成功后才启动，本次会话将永远没有
    // 定时上报：事件只能靠攒满 batchSize 或 App.onHide / onError 发出，崩溃 / 被杀即丢数据。
    // 安全性前提：flush() 前会 await 登录门闩（见文件顶部 setTrackingLoginWaiter），
    // 未登录时门闩返回 false 直接 return，不发任何请求（绝不匿名上报），事件留队等下次重试；
    // 队列为空时 flush 更是在等门闩之前就返回，不会平白触发登录。
    startFlushTimer()
    // 每次打开小程序自动完成「登录 + 系统配置」就绪
    rootStore.bootstrap().catch((error) => {
      console.warn('[bootstrap] 登录/系统配置就绪失败:', error)
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
