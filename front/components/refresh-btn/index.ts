import { bindTheme, getTheme, unbindTheme } from '../../utils/theme'

/** 悬浮刷新按钮延迟：距上次刷新成功满该时长后出现，提醒数据已「旧」可手动刷新 */
const REFRESH_BTN_DELAY = 10000
/**
 * 模块级共享（跨组件实例），原生 tabBar keep-alive 下页面实例常驻，时间源全局唯一：
 * - lastRefreshAt：最近一次刷新**成功**的时间戳（按钮出现计时用，0 = 从未成功）；
 * - pageVisible：组件所在页面是否可见（pageLifetimes 维护），计时到点后仅当页面可见才显示按钮。
 */
let lastRefreshAt = 0
let pageVisible = false
/** 按钮出现计时器（页面隐藏 / 组件卸载时清理，页面重新显示时按距上次成功时间重建） */
let refreshBtnTimer: ReturnType<typeof setTimeout> | null = null

/**
 * 悬浮刷新按钮：刷新成功 delay（默认 10s）后出现，点击触发页面刷新流程（triggerEvent('refresh')）。
 * 页面通过组件方法驱动：
 * - refreshDone()：刷新成功回调（隐藏按钮并重新计时）；
 * - restore()：刷新失败 / 防抖拦截时恢复可点状态（立即显示）；
 * - sync()：页面显示且不即将刷新时同步按钮状态。
 */
Component({
  properties: {
    theme: { type: String, value: 'light' },
    /** 距上次刷新成功后按钮出现的延迟（ms），默认 10s */
    delay: { type: Number, value: REFRESH_BTN_DELAY },
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
      this.clearTimer()
    },
  },
  pageLifetimes: {
    show() {
      pageVisible = true
      // 页面重新可见时，恢复被 hide() 清掉的计时器（或直接显示已超时的按钮）
      this.sync()
    },
    hide() {
      pageVisible = false
      // 页面不可见时清掉计时器，重新可见时由 show() 里的 sync() 重建
      this.clearTimer()
      // 同时隐藏按钮，避免返回时残留旧状态
      this.setData({ show: false, tapping: false })
    },
  },
  methods: {
    /** 刷新成功回调：记录成功时间，隐藏按钮并安排 delay 后重现 */
    refreshDone() {
      lastRefreshAt = Date.now()
      this.setData({ tapping: false })
      this.hide()
      this.schedule()
    },
    /** 隐藏按钮（淡出动画由 CSS transition 处理） */
    hide() {
      if (this.data.show) {
        this.setData({ show: false })
      }
    },
    /** 安排 delay 后显示按钮（若期间又有新刷新，会被重新安排 / 覆盖） */
    schedule() {
      this.clearTimer()
      const delay = this.data.delay
      refreshBtnTimer = setTimeout(() => {
        refreshBtnTimer = null
        // 到点后若期间没有新刷新（距上次成功已满 delay），且页面仍为可见页，则显示按钮
        if (Date.now() - lastRefreshAt >= delay && pageVisible) {
          this.setData({ show: true })
        }
      }, delay)
    },
    /**
     * 页面显示时同步按钮状态：距上次刷新成功 ≥delay 直接显示；不足则按剩余时间继续计时。
     * 从未刷新成功过（0）时不显示，等首次刷新成功后由刷新成功回调安排。
     */
    sync() {
      if (lastRefreshAt === 0) return
      const elapsed = Date.now() - lastRefreshAt
      if (elapsed >= this.data.delay) {
        this.clearTimer()
        if (pageVisible) this.setData({ show: true })
      } else {
        // 剩余时间重建计时器，避免提前或延迟出现
        this.clearTimer()
        const remaining = this.data.delay - elapsed
        refreshBtnTimer = setTimeout(() => {
          refreshBtnTimer = null
          if (Date.now() - lastRefreshAt >= this.data.delay && pageVisible) {
            this.setData({ show: true })
          }
        }, remaining)
      }
    },
    /**
     * 恢复按钮为可点状态：立即显示（用于刷新失败 / 防抖拦截场景，保证还能再点）。
     * 不再检查 lastRefreshAt > 0，首次加载失败时也应让用户重试。
     */
    restore() {
      this.clearTimer()
      this.setData({ show: true, tapping: false })
    },
    clearTimer() {
      if (refreshBtnTimer) {
        clearTimeout(refreshBtnTimer)
        refreshBtnTimer = null
      }
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
