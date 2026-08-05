import { rootStore } from '../../stores/root.store'
import type { ThemeMode } from '../../utils/storage'

Page({
  data: {
    activeTab: 'settings',
    theme: 'light' as ThemeMode,
    apiBaseUrl: '',
    mockEnabled: true,
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
      apiBaseUrl: settings.apiBaseUrl,
      mockEnabled: settings.useMockFallback,
      loggedIn: auth.isLoggedIn,
      userName: auth.user?.nickname || (auth.isLoggedIn ? '已登录用户' : '未登录'),
    })
  },
  onThemeChange(event: WechatMiniprogram.BaseEvent) {
    const value = (event.currentTarget as unknown as { dataset: { value: string } }).dataset.value
    rootStore.settings.setTheme(value as ThemeMode)
    this.syncData()
  },
  onApiInput(event: WechatMiniprogram.BaseEvent & { detail: { value: string } }) {
    this.setData({ apiBaseUrl: event.detail.value })
  },
  onSaveApi() {
    rootStore.settings.saveApiBaseUrl(this.data.apiBaseUrl)
    wx.showToast({ title: 'API 地址已保存', icon: 'success' })
    this.syncData()
  },
  onToggleMock(event: WechatMiniprogram.BaseEvent & { detail: { value: boolean } }) {
    rootStore.settings.useMockFallback = event.detail.value
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
      wx.showToast({ title: '登录成功', icon: 'success' })
      this.syncData()
    } catch {
      wx.showToast({ title: rootStore.auth.error || '登录失败', icon: 'none' })
    } finally {
      wx.hideLoading()
    }
  },
  onClearStorage() {
    wx.showModal({
      title: '清除本地数据',
      content: '将清除登录、主题和 API 配置，确定继续吗？',
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
