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
import { trackEvent } from '../../utils/tracker'
import { SHARE_HOME_PATH, SHARE_IMAGE_URL } from '../../utils/share'
import { getEnv, isReleaseBuild } from '../../config/env'
import { productionEnv } from '../../config/env.production'
import { APP_NAME } from '../../config/app'

Page({
  data: {
    theme: rootStore.settings.theme,
    themePref: rootStore.settings.themePref,
    user: null as User | null,
    isLoggedIn: false,
    version: '',
    isDev: !isReleaseBuild(),
    /** 当前实际生效环境是否为线上（按 getEnv() 推导，无覆盖的默认态按真实地址判定） */
    envIsProd: true,
    /** 当前小程序名称（按 AppID 动态解析，页脚展示） */
    appName: APP_NAME,
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
    // 从 env-switch 页返回后刷新 pill 状态（按实际生效地址，而非覆盖值）
    if (this.data.isDev) {
      this.setData({ envIsProd: getEnv().apiBaseUrl === productionEnv.apiBaseUrl })
    }
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
    // 埋点：用户主动切主题（跟随系统变化的自动切换不埋）
    trackEvent('theme.switch', value)
  },
  onServiceTap(event: WechatMiniprogram.BaseEvent) {
    const key = (event.currentTarget as unknown as { dataset: { key?: string } }).dataset.key
    if (!key) return
    wx.navigateTo({ url: `/packageAbout/pages/legal/index?type=${key}` })
  },
  onFeedbackTap() {
    wx.navigateTo({ url: '/packageAbout/pages/custom/index' })
  },
  onEnvSwitchTap() {
    wx.navigateTo({ url: '/packageAbout/pages/env-switch/index' })
  },
  onTreemapTap() {
    wx.navigateTo({ url: '/packageTreemap/pages/treemap/index' })
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
    trackEvent('share.trigger')
    return {
      title: APP_NAME,
      path: SHARE_HOME_PATH,
      imageUrl: SHARE_IMAGE_URL,
    }
  },
})
