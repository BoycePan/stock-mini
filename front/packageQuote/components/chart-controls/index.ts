/**
 * 图表缩放 / 平移控件条：`− + ‹ ›` 四个按钮 + 左侧窗口文案。
 *
 * 由两个 K 线图表组件共用（quote-chart / kline-chart），保证两处手感与样式一致；
 * 组件自身不持有窗口状态，只把点击透传成事件，越界判断与夹紧都在父组件的窗口模型里
 * （见 utils/kline-viewport.ts）。
 *
 * 事件：`zoomin` / `zoomout` / `panleft` / `panright`（禁用态不触发）。
 * 主题：`theme` 属性 + 根节点 `dark` 类（组件样式隔离，深色规则写在本组件 wxss）。
 */
Component({
  properties: {
    theme: { type: String, value: 'light' },
    /** 是否展示整条控件（非 K 线周期 / 数据太短时不展示） */
    show: { type: Boolean, value: false },
    /** 窗口文案，例：`30 / 500 根` */
    rangeText: { type: String, value: '' },
    zoomInDisabled: { type: Boolean, value: false },
    zoomOutDisabled: { type: Boolean, value: false },
    panLeftDisabled: { type: Boolean, value: false },
    panRightDisabled: { type: Boolean, value: false },
  },
  methods: {
    /** 点击统一入口：禁用态直接忽略（父组件的夹紧是兜底，这里避免无意义的 setData） */
    onTap(event: WechatMiniprogram.TouchEvent) {
      const action = event.currentTarget.dataset.action as string | undefined
      if (!action || event.currentTarget.dataset.disabled) return
      this.triggerEvent(action)
    },
  },
})
