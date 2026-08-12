Component({
  properties: {
    title: { type: String, value: '全球市场追踪' },
    showShare: { type: Boolean, value: true },
    showBack: { type: Boolean, value: false },
    showSearch: { type: Boolean, value: false },
  },
  lifetimes: {
    attached() {
      const windowInfo = wx.getWindowInfo()
      const safeTop = windowInfo.safeArea?.top ?? 0
      const basePaddingTop = (26 * windowInfo.windowWidth) / 750

      this.setData({
        headerStyle: `padding-top: ${basePaddingTop + safeTop}px;`,
      })
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
