import { bindTheme, getTheme, unbindTheme } from '../../utils/theme'

/** 滚动停止判定延迟：超过该时长没有新的 scroll 事件才视为「停下」，此时才显示按钮 */
const STOP_DEBOUNCE = 300
/** 一屏高度（px）：scroll-view 的 scrollTop 单位也是 px，可直接比较 */
let threshold = 0
/**
 * 模块级共享（跨组件实例），原生 tabBar keep-alive 下组件常驻：
 * - scrollTop：最新滚动位置；
 * - suppressed：刷新按钮显示时由页面抑制（true 时隐藏，两按钮互斥）；
 * - stopTimer：滚动停止判定计时器（页面隐藏 / 组件卸载时清理）。
 */
let scrollTop = 0
let suppressed = false
let stopTimer: ReturnType<typeof setTimeout> | null = null

function clearStopTimer() {
  if (stopTimer) {
    clearTimeout(stopTimer)
    stopTimer = null
  }
}

/** 重新开始「停止判定」：滚动中会反复重置，只有停下 STOP_DEBOUNCE 后才会走到展示逻辑 */
function restartStopTimer(instance: WechatMiniprogram.Component.TrivialInstance) {
  clearStopTimer()
  stopTimer = setTimeout(() => {
    stopTimer = null
    if (scrollTop > threshold && !suppressed && !instance.data.show) {
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
      if (!threshold) threshold = wx.getWindowInfo().windowHeight
      this.setData({ theme: getTheme() })
      bindTheme(this)
    },
    detached() {
      unbindTheme(this)
      clearStopTimer()
    },
  },
  pageLifetimes: {
    show() {
      // 回到当前页：若仍满足显示条件（已超过一屏且未被抑制），重新走停止判定
      if (scrollTop > threshold && !suppressed) {
        restartStopTimer(this)
      }
    },
    hide() {
      // 页面不可见：清掉计时并隐藏，避免返回时残留旧状态
      clearStopTimer()
      this.setData({ show: false })
    },
  },
  methods: {
    /** 页面滚动回调（高频）：记录位置，超过一屏进入停止判定，未超过立即隐藏 */
    scroll(value: number) {
      scrollTop = value
      if (value <= threshold) {
        clearStopTimer()
        if (this.data.show) {
          this.setData({ show: false })
        }
        return
      }
      restartStopTimer(this)
    },
    /** 页面抑制（刷新按钮显示时）：立即隐藏并暂停滚动判定；解除抑制后按当前滚动位置恢复判定 */
    setSuppressed(active: boolean) {
      suppressed = active
      if (active) {
        clearStopTimer()
        if (this.data.show) {
          this.setData({ show: false })
        }
      } else if (scrollTop > threshold) {
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
