import { bindTheme, getTheme, unbindTheme } from '../../utils/theme'

Component({
  properties: {
    active: { type: String, value: 'global' },
    theme: { type: String, value: 'light' },
  },
  data: {
    tabs: [
      { key: 'global', label: '全球', icon: '◎' },
      { key: 'asia', label: '日韩', icon: '⊕' },
      { key: 'metals', label: '有色', icon: '◇' },
      { key: 'finance', label: '财经', icon: '◔' },
      { key: 'settings', label: '设置', icon: '✤' },
    ],
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
    onTab(event: WechatMiniprogram.BaseEvent) {
      const key = (event.currentTarget as unknown as { dataset: { key: string } }).dataset.key
      this.triggerEvent('change', { key })
    },
  },
})
