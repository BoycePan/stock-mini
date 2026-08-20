import { bindTheme, getTheme, unbindTheme } from '../../utils/theme'

Component({
  data: {
    theme: 'light',
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
