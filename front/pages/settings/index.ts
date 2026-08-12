import { rootStore } from '../../stores/root.store'
import type { ThemeMode } from '../../utils/storage'

Page({
  data: {
    activeTab: 'settings',
    theme: 'light' as ThemeMode,
    loggedIn: false,
    userName: '未登录',
  },
  onLoad() {
    this.syncData()
  },
  onShow() {
    this.syncData()
  },
  syncData() {
    const { settings, auth } = rootStore
    this.setData({
      theme: settings.theme,
      loggedIn: auth.isLoggedIn,
      userName: auth.user?.nickname || (auth.isLoggedIn ? '已登录用户' : '未登录'),
    })
  },
  onThemeChange(event: WechatMiniprogram.BaseEvent) {
    const value = (event.currentTarget as unknown as { dataset: { value: string } }).dataset.value
    rootStore.settings.setTheme(value as ThemeMode)
    this.syncData()
  },
  async onLogin() {
    if (rootStore.auth.isLoggedIn) {
      rootStore.auth.logout()
      this.syncData()
      wx.showToast({ title: '已退出登录', icon: 'none' })
      return
    }
    wx.showLoading({ title: '登录中' })
    try {
      await rootStore.auth.login()
      console.log('🏷️ index.ts ~ 56 => ', 123)
      wx.showToast({ title: '登录成功', icon: 'success' })
      this.syncData()
    } catch {
      wx.showToast({ title: rootStore.auth.error || '登录失败', icon: 'none' })
    } finally {
      wx.hideLoading()
    }
  },
  onServiceTap(event: WechatMiniprogram.BaseEvent) {
    const key = (event.currentTarget as unknown as { dataset: { key?: string } }).dataset.key
    if (!key) return
    wx.navigateTo({ url: `/pages/legal/index?type=${key}` })
  },
  onClearStorage() {
    wx.showModal({
      title: '清除本地数据',
      content: '将清除登录状态和主题设置，确定继续吗？',
      success: (result) => {
        if (!result.confirm) return
        wx.clearStorageSync()
        rootStore.auth.reset()
        rootStore.settings.reset()
        wx.showToast({ title: '已清除', icon: 'success' })
        this.syncData()
      },
    })
  },
  onTabChange(event: WechatMiniprogram.CustomEvent<{ key: string }>) {
    const key = event.detail.key
    if (key !== this.data.activeTab) wx.redirectTo({ url: `/pages/${key}/index` })
  },
})
