import { rootStore } from '../../stores/root.store'
import type { User } from '../../types/user'
import type { ThemePreference } from '../../utils/storage'
import {
  bindGlobalAuth,
  registerStoreBinding,
  releaseStoreBindings,
} from '../../utils/store-bindings'
import { bindTheme, unbindTheme } from '../../utils/theme'
import { getAppVersion } from '../../utils/version'
import { SHARE_HOME_PATH, SHARE_IMAGE_URL } from '../../utils/share'

Page({
  data: {
    theme: rootStore.settings.theme,
    themePref: rootStore.settings.themePref,
    user: null as User | null,
    isLoggedIn: false,
    version: '',
  },
  onLoad() {
    bindTheme(this)
    // 版本号动态读取：体验版 / 正式版取微信运行时上报的发版版本号，开发版回退兜底版本
    this.setData({ version: getAppVersion() })
    // 用户信息 / 登录态来自全局 auth store，登录、登出自动同步
    registerStoreBinding(this, bindGlobalAuth(this))
    this.ensureAutoLogin()
  },
  onShow() {
    // 同步底部自定义 tabBar 激活态（原生 tabBar keep-alive，onShow 幂等）
    this.syncTabBar()
  },

  ensureAutoLogin() {
    if (!rootStore.auth.isLoggedIn) {
      rootStore.auth.ensureLogin().catch((err: unknown) => {
        console.warn('[settings] 自动登录失败:', err)
      })
    }
  },
  onLoginTap() {
    if (!rootStore.auth.isLoggedIn) {
      rootStore.auth.login().catch((err: unknown) => {
        console.warn('[settings] 登录失败:', err)
      })
    }
  },
  onThemeChange(event: WechatMiniprogram.BaseEvent) {
    const value = (event.currentTarget as unknown as { dataset: { value: string } }).dataset.value
    rootStore.settings.setTheme(value as ThemePreference)
  },
  onServiceTap(event: WechatMiniprogram.BaseEvent) {
    const key = (event.currentTarget as unknown as { dataset: { key?: string } }).dataset.key
    if (!key) return
    wx.navigateTo({ url: `/pages/legal/index?type=${key}` })
  },
  onFeedbackTap() {
    wx.navigateTo({ url: '/pages/custom/index' })
  },
  onUnload() {
    releaseStoreBindings(this)
    unbindTheme(this)
  },
  /** 同步底部自定义 tabBar 的激活态到当前页（custom-tab-bar 常驻渲染层，由框架管理） */
  syncTabBar() {
    if (typeof this.getTabBar === 'function') {
      const tabBar = this.getTabBar()
      if (tabBar) tabBar.setData({ selected: 'settings' })
    }
  },
  onShareAppMessage(): WechatMiniprogram.Page.ICustomShareContent {
    return {
      title: '市场追踪助手',
      path: SHARE_HOME_PATH,
      imageUrl: SHARE_IMAGE_URL,
    }
  },
})
