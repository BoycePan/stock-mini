import { bindTheme, getTheme, unbindTheme } from '../../utils/theme'

/**
 * 按实例记录的「所在页面是否可见」（WeakSet 键为 this，与 components/section-card 的
 * prevMetrics / bumpTimers 同风格）。
 *
 * 不用模块级共享布尔量：一旦第二个页面复用本组件，任一实例隐藏就会把它置 false，
 * 另一实例的 show() 会被静默忽略（按钮再也亮不起来），属于隐性串页。
 */
const visibleInstances = new WeakSet<object>()

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
      visibleInstances.delete(this)
      unbindTheme(this)
    },
  },
  pageLifetimes: {
    show() {
      visibleInstances.add(this)
    },
    hide() {
      visibleInstances.delete(this)
      // 同时隐藏按钮，避免返回时残留旧状态
      this.setData({ show: false, tapping: false })
    },
  },
  methods: {
    /** 按钮当前是否处于显示状态（供页面轮询判断是否跳过本轮请求） */
    isShown() {
      return this.data.show
    },
    /** 页面检测到最新新闻时调用：显示按钮（页面不可见 / 已显示时忽略） */
    show() {
      if (visibleInstances.has(this) && !this.data.show) {
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
