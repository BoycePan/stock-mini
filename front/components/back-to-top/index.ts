import { bindTheme, getTheme, unbindTheme } from '../../utils/theme'

/** 滚动停止判定延迟：超过该时长没有新的 scroll 事件才视为「停下」，此时才显示按钮 */
const STOP_DEBOUNCE = 300

/**
 * 按组件实例存放的状态（WeakMap 键为 this，与 components/section-card 的 prevMetrics /
 * bumpTimers 写法一致）。
 *
 * 为什么不能用模块级共享变量：一旦第二个页面复用本组件，任一实例卸载 / 隐藏都会清掉另一实例的
 * 计时器、抑制状态（suppressed）会串页、滚动位置会互相覆盖。改为按实例存放后，
 * 各实例的状态互不影响，并在 detached 清理（避免定时器泄漏）。
 */
interface BackToTopState {
  /** 一屏高度（px）：scroll-view 的 scrollTop 单位也是 px，可直接比较；页面 resize 时重算 */
  threshold: number
  /** 最新滚动位置 */
  scrollTop: number
  /** 刷新按钮显示时由页面抑制（true 时隐藏，两按钮互斥） */
  suppressed: boolean
  /** 滚动停止判定计时器（页面隐藏 / 组件卸载时清理） */
  stopTimer: ReturnType<typeof setTimeout> | null
}

/** 组件实例 → 按实例状态 */
const states = new WeakMap<object, BackToTopState>()

/** 取实例状态（首次访问时初始化；threshold 由 attached 按窗口高度填充） */
function stateOf(instance: object): BackToTopState {
  let state = states.get(instance)
  if (!state) {
    state = { threshold: 0, scrollTop: 0, suppressed: false, stopTimer: null }
    states.set(instance, state)
  }
  return state
}

function clearStopTimer(state: BackToTopState) {
  if (state.stopTimer) {
    clearTimeout(state.stopTimer)
    state.stopTimer = null
  }
}

/** 重新开始「停止判定」：滚动中会反复重置，只有停下 STOP_DEBOUNCE 后才会走到展示逻辑 */
function restartStopTimer(instance: WechatMiniprogram.Component.TrivialInstance) {
  const state = stateOf(instance)
  clearStopTimer(state)
  state.stopTimer = setTimeout(() => {
    state.stopTimer = null
    if (state.scrollTop > state.threshold && !state.suppressed && !instance.data.show) {
      instance.setData({ show: true })
    }
  }, STOP_DEBOUNCE)
}

/**
 * 回到顶部悬浮按钮：右下角圆形，样式与悬浮刷新按钮（refresh-btn）一致，图标为向上箭头。
 * 显示条件：页面滚动超过一屏高度（可视区高度）且已停止滚动（STOP_DEBOUNCE 内无滚动事件）；
 * 刷新按钮显示时页面会抑制（setSuppressed(true)），保证两按钮不同时出现。
 * 点击后触发 totop 事件，由页面将 scroll-view 滚回顶部。
 */
Component({
  properties: {
    theme: { type: String, value: 'light' },
  },
  data: {
    /** 是否显示（淡入/淡出动画由 .show 类 + CSS transition 处理） */
    show: false,
  },
  lifetimes: {
    attached() {
      const state = stateOf(this)
      if (!state.threshold) state.threshold = wx.getWindowInfo().windowHeight
      this.setData({ theme: getTheme() })
      bindTheme(this)
    },
    detached() {
      // 清掉本实例的停止判定计时器并释放状态（模块级共享时这里会误清其它实例的计时器）
      clearStopTimer(stateOf(this))
      states.delete(this)
      unbindTheme(this)
    },
  },
  pageLifetimes: {
    show() {
      // 回到当前页：若仍满足显示条件（已超过一屏且未被抑制），重新走停止判定
      const state = stateOf(this)
      if (state.scrollTop > state.threshold && !state.suppressed) {
        restartStopTimer(this)
      }
    },
    hide() {
      // 页面不可见：清掉计时并隐藏，避免返回时残留旧状态
      clearStopTimer(stateOf(this))
      this.setData({ show: false })
    },
    /** 所在页面尺寸变化（横竖屏切换 / 小窗等）：重算本实例的一屏高度，避免阈值停留在旧尺寸 */
    resize() {
      stateOf(this).threshold = wx.getWindowInfo().windowHeight
    },
  },
  methods: {
    /** 页面滚动回调（高频）：记录位置，超过一屏进入停止判定，未超过立即隐藏 */
    scroll(value: number) {
      const state = stateOf(this)
      state.scrollTop = value
      if (value <= state.threshold) {
        clearStopTimer(state)
        if (this.data.show) {
          this.setData({ show: false })
        }
        return
      }
      restartStopTimer(this)
    },
    /** 页面抑制（刷新按钮显示时）：立即隐藏并暂停滚动判定；解除抑制后按当前滚动位置恢复判定 */
    setSuppressed(active: boolean) {
      const state = stateOf(this)
      state.suppressed = active
      if (active) {
        clearStopTimer(state)
        if (this.data.show) {
          this.setData({ show: false })
        }
      } else if (state.scrollTop > state.threshold) {
        restartStopTimer(this)
      }
    },
    /** 点击回到顶部：隐藏并通知页面滚动回顶 */
    onTap() {
      this.setData({ show: false })
      this.triggerEvent('totop')
    },
  },
})
