import { bindTheme, getTheme, unbindTheme } from '../../utils/theme'

Component({
  properties: {
    section: { type: Object, value: {} },
    compact: { type: Boolean, value: false },
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
  methods: {
    onMetricTap(event: WechatMiniprogram.TouchEvent) {
      const index = event.currentTarget.dataset.index as number | undefined
      if (index === undefined) return
      const metric = this.data.section?.metrics?.[index]
      if (metric) this.triggerEvent('metrictap', { metric })
    },
  },
})
