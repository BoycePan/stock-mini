Component({
  properties: {
    active: { type: String, value: 'global' },
  },
  data: {
    tabs: [
      { key: 'global', label: '全球', icon: '◎' },
      { key: 'asia', label: '日韩', icon: '⊕' },
      { key: 'metals', label: '有色', icon: '◇' },
      { key: 'ai', label: 'AI', icon: '◔' },
      { key: 'settings', label: '设置', icon: '✤' },
    ],
  },
  methods: {
    onTab(event: WechatMiniprogram.BaseEvent) {
      const key = (event.currentTarget as unknown as { dataset: { key: string } }).dataset.key
      this.triggerEvent('change', { key })
    },
  },
})
