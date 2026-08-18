import { bindTheme, getTheme, unbindTheme } from '../../utils/theme'

/**
 * 通用说明弹窗：半透明遮罩 + 居中卡片（标题 + 正文 + 「知道了」）。
 * 父组件通过 visible 控制显隐，点击遮罩或「知道了」触发 close 事件由父组件关闭。
 */
Component({
  properties: {
    visible: { type: Boolean, value: false },
    title: { type: String, value: '提示' },
    content: { type: String, value: '' },
  },
  data: {
    theme: 'light' as string,
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
  methods: {
    onClose() {
      this.triggerEvent('close')
    },
    /** 阻止卡片内点击冒泡到遮罩（遮罩点击才关闭） */
    noop() {},
  },
})
