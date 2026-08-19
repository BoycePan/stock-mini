import { rootStore } from '../../stores/root.store'
import type { User } from '../../types/user'
import type { ThemeMode } from '../../utils/storage'
import {
  bindGlobalAuth,
  registerStoreBinding,
  releaseStoreBindings,
} from '../../utils/store-bindings'
import { bindTheme, unbindTheme } from '../../utils/theme'
import { getAppVersion } from '../../utils/version'

Page({
  data: {
    activeTab: 'settings',
    theme: rootStore.settings.theme,
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
  },
  onThemeChange(event: WechatMiniprogram.BaseEvent) {
    const value = (event.currentTarget as unknown as { dataset: { value: string } }).dataset.value
    rootStore.settings.setTheme(value as ThemeMode)
  },
  onServiceTap(event: WechatMiniprogram.BaseEvent) {
    const key = (event.currentTarget as unknown as { dataset: { key?: string } }).dataset.key
    if (!key) return
    wx.navigateTo({ url: `/pages/legal/index?type=${key}` })
  },
  onUnload() {
    releaseStoreBindings(this)
    unbindTheme(this)
  },
  onTabChange(event: WechatMiniprogram.CustomEvent<{ key: string }>) {
    const key = event.detail.key
    if (key !== this.data.activeTab) wx.redirectTo({ url: `/pages/${key}/index` })
  },
})
