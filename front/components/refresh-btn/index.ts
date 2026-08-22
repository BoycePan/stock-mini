import { bindTheme, getTheme, unbindTheme } from '../../utils/theme'

/**
 * 模块级共享（跨组件实例），原生 tabBar keep-alive 下组件常驻：
 * pageVisible：组件所在页面是否可见（pageLifetimes 维护），页面隐藏时不再显示按钮。
 */
let pageVisible = false

/**
 * 悬浮刷新按钮：右下角圆形，出现/隐藏完全由页面驱动——
 * - 页面轮询发现最新新闻时调用 show() 显示；
 * - 刷新成功后调用 refreshDone() 隐藏（重新出现由下一次轮询决定）；
 * - 刷新失败时页面调用 restore() 立即重现，允许稍后重试。
 * 点击触发页面刷新流程（triggerEvent('refresh')）。
 */
Component({
  properties: {
    theme: { type: String, value: 'light' },
  },
  data: {
    /** 是否显示（淡入/淡出动画由 .show 类 + CSS transition 处理） */
    show: false,
    /** 是否正在刷新中（防止重复点击） */
    tapping: false,
  },
  lifetimes: {
    attached() {
      this.setData({ theme: getTheme() })
      bindTheme(this)
    },
    detached() {
      unbindTheme(this)
    },
  },
  pageLifetimes: {
    show() {
      pageVisible = true
    },
    hide() {
      pageVisible = false
      // 同时隐藏按钮，避免返回时残留旧状态
      this.setData({ show: false, tapping: false })
    },
  },
  methods: {
    /** 页面检测到最新新闻时调用：显示按钮（页面不可见 / 已显示时忽略） */
    show() {
      if (pageVisible && !this.data.show) {
        this.setData({ show: true })
      }
    },
    /** 刷新成功回调：隐藏按钮（重新出现由页面轮询按最新新闻驱动） */
    refreshDone() {
      this.setData({ tapping: false })
      this.hide()
    },
    /** 隐藏按钮（淡出动画由 CSS transition 处理） */
    hide() {
      if (this.data.show) {
        this.setData({ show: false })
      }
    },
    /** 恢复按钮为可点状态：立即显示（仅刷新失败场景，保证还能再点） */
    restore() {
      this.setData({ show: true, tapping: false })
    },
    /** 点击按钮：防重复点击，隐藏（淡出动画）并通知页面执行与下拉刷新相同的刷新流程 */
    onTap() {
      if (this.data.tapping) return
      this.setData({ tapping: true })
      this.hide()
      this.triggerEvent('refresh')
    },
  },
})
