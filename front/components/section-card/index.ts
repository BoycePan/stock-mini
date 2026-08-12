Component({
  properties: {
    section: { type: Object, value: {} },
    compact: { type: Boolean, value: false },
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
