import type { MarketSection } from '../../types/market'
import { bindTheme, getTheme, unbindTheme } from '../../utils/theme'

Component({
  properties: {
    /** 当前激活的 TabBar 标签 */
    activeTab: { type: String, value: '' },
    /** 是否显示分享按钮 */
    showShare: { type: Boolean, value: false },
    /** 是否正在加载 */
    loading: { type: Boolean, value: true },
    /** 错误信息 */
    error: { type: String, value: '' },
    /** 加载中提示主文本 */
    loadingText: { type: String, value: '正在加载行情' },
    /** 加载中提示副文本 */
    loadingDesc: { type: String, value: '正在为您同步最新数据，请稍候…' },
    /** 市场状态标签（如「开市中」「休市」） */
    statusLabel: { type: String, value: '' },
    /** 市场状态色调：'open' | 'rest' */
    statusTone: { type: String, value: 'rest' },
    /** 数据更新时间标签 */
    updatedLabel: { type: String, value: '' },
    /** 板块数据列表 */
    sections: { type: Array, value: [] as MarketSection[] },
  },
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
  methods: {
    onRetry() {
      this.triggerEvent('retry')
    },
    onShare() {
      this.triggerEvent('share')
    },
    onTabChange(event: WechatMiniprogram.CustomEvent<{ key: string }>) {
      this.triggerEvent('tabchange', event.detail)
    },
    onMetricTap(event: WechatMiniprogram.CustomEvent) {
      this.triggerEvent('metrictap', event.detail)
    },
  },
})
