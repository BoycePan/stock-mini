import { bindTheme, getTheme, unbindTheme } from '../../utils/theme'

Component({
  properties: {
    title: { type: String, value: '全球市场追踪' },
    showShare: { type: Boolean, value: true },
    showBack: { type: Boolean, value: false },
    showSearch: { type: Boolean, value: false },
    showBrand: { type: Boolean, value: true },
    theme: { type: String, value: 'light' },
  },
  lifetimes: {
    attached() {
      this.setData({ theme: getTheme() })
      bindTheme(this)
      const windowInfo = wx.getWindowInfo()
      const safeTop = windowInfo.safeArea?.top ?? 0
      const basePaddingTop = (26 * windowInfo.windowWidth) / 750

      this.setData({
        headerStyle: `padding-top: ${basePaddingTop + safeTop}px;`,
      })
    },
    detached() {
      unbindTheme(this)
    },
  },
  methods: {
    onShare() {
      this.triggerEvent('share')
    },
    onSearch() {
      wx.navigateTo({ url: '/pages/search/index' })
    },
    onBack() {
      const pages = getCurrentPages()
      if (pages.length > 1) {
        wx.navigateBack()
      } else {
        wx.reLaunch({ url: '/pages/settings/index' })
      }
    },
  },
})
