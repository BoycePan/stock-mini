import { bindTheme, getTheme, unbindTheme } from '../../utils/theme'

Component({
  properties: {
    title: { type: String, value: '暂无数据' },
    description: { type: String, value: '' },
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
