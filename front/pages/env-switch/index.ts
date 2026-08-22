import { rootStore } from '../../stores/root.store'
import { developmentEnv } from '../../config/env.development'
import { productionEnv } from '../../config/env.production'
import { getEnvOverride, setEnvOverride } from '../../utils/storage'
import { getEnv } from '../../config/env'
import { bindTheme, unbindTheme } from '../../utils/theme'
import type { EnvOverride } from '../../utils/storage'

Page({
  data: {
    theme: rootStore.settings.theme,
    currentOverride: null as EnvOverride | null,
    currentApiBaseUrl: '',
    productionUrl: productionEnv.apiBaseUrl,
    localUrl: developmentEnv.apiBaseUrl,
  },

  onLoad() {
    bindTheme(this)
    this.refreshState()
  },

  onShow() {
    this.refreshState()
  },

  onUnload() {
    unbindTheme(this)
  },

  refreshState() {
    const override = getEnvOverride()
    this.setData({
      currentOverride: override,
      currentApiBaseUrl: getEnv().apiBaseUrl,
    })
  },

  onEnvSelect(event: WechatMiniprogram.BaseEvent) {
    const env = (event.currentTarget as unknown as { dataset: { env: EnvOverride } }).dataset.env
    const currentOverride = this.data.currentOverride
    // 已经是当前环境，无需切换
    if (env === 'production' && (currentOverride === 'production' || currentOverride === null))
      return
    if (env === currentOverride) return

    const label = env === 'production' ? '线上' : '本地开发'
    wx.showModal({
      title: '切换接口环境',
      content: `即将切换到「${label}」环境，小程序会自动重启，确认？`,
      confirmText: '确认切换',
      cancelText: '取消',
      confirmColor: env === 'local' ? '#f07430' : '#4278ed',
      success: (res) => {
        if (!res.confirm) return
        setEnvOverride(env)
        this.doRestart()
      },
    })
  },

  onResetEnv() {
    if (this.data.currentOverride === null) return
    wx.showModal({
      title: '恢复默认',
      content: '将恢复线上环境并重启小程序，确认？',
      confirmText: '确认',
      cancelText: '取消',
      success: (res) => {
        if (!res.confirm) return
        setEnvOverride(null)
        this.doRestart()
      },
    })
  },

  /**
   * 重启小程序主页：清除页面栈，所有页面重新初始化， getEnv() 会重新读取 Storage。
   * wx.restartMiniProgram 在开发者工具模拟器不稳定，改用 reLaunch 到首页效果等价且兼容性更好。
   * 必须先 logout 清空内存中的 token/loginPromise，否则 rootStore 单例还在内存中，
   * reLaunch 后页面 onLoad 调用 ensureLogin() 会直接复用旧 token 而不重新登录。
   */
  doRestart() {
    // 清空内存中的登录状态 + loginPromise + Storage token，让新页面重新走登录流程
    rootStore.auth.logout()
    wx.reLaunch({
      url: '/pages/global/index',
      fail: () => {
        wx.showToast({ title: '重启失败，请手动重开', icon: 'none' })
      },
    })
  },
})
