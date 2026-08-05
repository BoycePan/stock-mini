Component({
  properties: {
    title: { type: String, value: '市场魔方助手' },
    showShare: { type: Boolean, value: true },
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
  },
})
