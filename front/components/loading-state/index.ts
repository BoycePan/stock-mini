import { bindTheme, getTheme, unbindTheme } from '../../utils/theme'

Component({
  properties: {
    text: { type: String, value: '加载中，请稍候…' },
    desc: { type: String, value: '正在为您加载最新数据' },
    theme: { type: String, value: 'light' },
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
})
