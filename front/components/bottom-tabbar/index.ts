import { bindTheme, getTheme, unbindTheme } from '../../utils/theme'

Component({
  properties: {
    active: { type: String, value: 'global' },
    theme: { type: String, value: 'light' },
  },
  data: {
    tabs: [
      { key: 'global', label: '全球', iconClass: 'icon-quanqiu' },
      { key: 'asia', label: '日韩', iconClass: 'icon-target-full' },
      { key: 'metals', label: '有色', iconClass: 'icon-yousejinshu' },
      { key: 'finance', label: '财经', iconClass: 'icon-caijingrili' },
      { key: 'settings', label: '设置', iconClass: 'icon-shezhi' },
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
