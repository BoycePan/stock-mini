import { bindTheme, getTheme, unbindTheme } from '../utils/theme'

/**
 * 原生自定义 tabBar（app.json tabBar.custom = true 时由框架自动挂载，路径固定在项目根 custom-tab-bar/）。
 *
 * 与旧版「页面内嵌 bottom-tabbar + wx.redirectTo」的区别：
 * - 组件常驻 tabbar 渲染层，切 tab 不销毁重建，从根源消除顶部/底部区域闪烁；
 * - 切换使用 wx.switchTab：tabBar 页面 keep-alive（onLoad 只触发一次、onShow/onHide 由框架驱动），
 *   各页面「首次显示加载数据、onShow 补刷新、onHide 停表」的现有机制无需任何改动；
 * - 页面在 onShow 中通过 this.getTabBar().setData({ selected }) 同步激活态；
 *   冷启动首次渲染时 getTabBar() 可能晚于页面 onShow，这里按当前路由兜底初始化。
 */
Component({
  data: {
    selected: 'global',
    theme: 'light',
    list: [
      { key: 'global', label: '全球', iconClass: 'icon-quanqiu' },
      { key: 'asia', label: '日韩', iconClass: 'icon-target-full' },
      { key: 'metals', label: '有色', iconClass: 'icon-yousejinshu' },
      { key: 'finance', label: '财经', iconClass: 'icon-caijingrili' },
      { key: 'settings', label: '设置', iconClass: 'icon-shezhi' },
    ],
  },
  lifetimes: {
    attached() {
      this.setData({ theme: getTheme() })
      bindTheme(this)
      // 冷启动兜底：按当前页面路由初始化激活态，避免依赖 getTabBar() 时序
      const pages = getCurrentPages()
      const route = pages[pages.length - 1]?.route ?? ''
      const match = this.data.list.find((tab) => `pages/${tab.key}/index` === route)
      if (match) this.setData({ selected: match.key })
    },
    detached() {
      unbindTheme(this)
    },
  },
  methods: {
    onTab(event: WechatMiniprogram.BaseEvent) {
      const key = (event.currentTarget as unknown as { dataset: { key: string } }).dataset.key
      if (!key || key === this.data.selected) return
      // 先更新高亮保证点击即时反馈；页面 onShow 会再次同步（幂等）
      this.setData({ selected: key })
      wx.switchTab({ url: `/pages/${key}/index` })
    },
  },
})
