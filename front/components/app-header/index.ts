import { bindTheme, getTheme, unbindTheme } from '../../utils/theme'

Component({
  properties: {
    title: { type: String, value: '市场追踪助手' },
    showShare: { type: Boolean, value: true },
    /** 是否显示「分享海报」按钮（生成海报，区别于右上角胶囊菜单分享） */
    posterShare: { type: Boolean, value: false },
    showBack: { type: Boolean, value: false },
    showSearch: { type: Boolean, value: false },
    showBrand: { type: Boolean, value: true },
    theme: { type: String, value: 'light' },
  },
  data: {
    headerStyle: '',
    /** 胶囊按钮高度（px），分享按钮与之保持一致（兜底 32px） */
    capsuleHeight: 32,
    /** 胶囊圆角 = 高度一半（px） */
    capsuleRadius: 16,
  },
  lifetimes: {
    attached() {
      this.setData({ theme: getTheme() })
      bindTheme(this)
      this.updateHeaderStyle()
    },
    detached() {
      unbindTheme(this)
    },
  },
  pageLifetimes: {
    resize() {
      // 窗口尺寸变化（如旋转 / iPad 分屏）时重新计算，避免胶囊距离失效
      this.updateHeaderStyle()
    },
  },
  methods: {
    /**
     * 计算导航栏内边距，确保与右上角胶囊按钮（菜单按钮）保持安全距离：
     * - 垂直方向：内容区与胶囊垂直居中对齐（padding-top = 状态栏高度，总高度 = 胶囊所在区域高度）；
     * - 水平方向：右侧预留 `窗口宽度 - 胶囊left` 的间距，保证「搜索 / 分享」按钮不会与胶囊重叠。
     */
    updateHeaderStyle() {
      const windowInfo = wx.getWindowInfo()
      const statusBarHeight = windowInfo.statusBarHeight ?? windowInfo.safeArea?.top ?? 0
      const menuButton = wx.getMenuButtonBoundingClientRect()
      const hasCapsule =
        !!menuButton && menuButton.top > 0 && menuButton.left > 0 && menuButton.height > 0

      let headerStyle: string
      if (hasCapsule) {
        // 胶囊顶部到状态栏底部的距离
        const capsuleTopGap = Math.max(menuButton.top - statusBarHeight, 0)
        const navHeight = statusBarHeight + capsuleTopGap * 2 + menuButton.height
        // 胶囊左边缘到屏幕右边缘的距离，再留 8px 呼吸空间
        const rightInset = Math.max(windowInfo.windowWidth - menuButton.left, 0) + 8
        // padding-top 设为胶囊顶部坐标，使内容顶部与胶囊顶部精确平齐
        headerStyle = `padding-top: ${menuButton.top}px; height: ${navHeight}px; padding-right: ${rightInset}px;`
        // 分享按钮与胶囊等高、同圆角，视觉上对齐
        this.setData({
          headerStyle,
          capsuleHeight: menuButton.height,
          capsuleRadius: Math.round(menuButton.height / 2),
        })
      } else {
        // 兜底：拿不到胶囊信息时退化为旧逻辑（安全区顶部 + 估算值）
        const safeTop = windowInfo.safeArea?.top ?? statusBarHeight
        const basePaddingTop = (26 * windowInfo.windowWidth) / 750
        headerStyle = `padding-top: ${safeTop + basePaddingTop}px;`
        this.setData({ headerStyle })
      }
    },
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
        // 无上级页面（分享卡片 / 外部深链经 redirectTo 进入，页面栈只剩当前页）：
        // 回退到小程序首页（首个 tab 页），而不是跳去设置页
        wx.switchTab({ url: '/pages/global/index' })
      }
    },
  },
})
