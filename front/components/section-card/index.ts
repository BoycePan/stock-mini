import type { MarketMetric, MarketSection } from '../../types/market'
import { bindTheme, getTheme, unbindTheme } from '../../utils/theme'
import { trackEvent } from '../../utils/tracker'

/** 用于对比两次刷新之间单个指标是否变化的快照 */
interface MetricSnapshot {
  value: string
  change: number
}

/**
 * 指标跳动动画的对比基线（按实例存放）。
 * tabKey = 上次记录基线时该面板选中的 Tab 键（无 Tab 面板为空串）：面板内切换 Tab 时
 * 指标整份换掉（如行业板块 A股 ⇄ 美股），只能重置基线、不能把两个市场的数值差异
 * 当成「行情变动」整屏跳动。
 */
interface BumpBaseline {
  tabKey: string
  snapshots: Map<string, MetricSnapshot>
}

/** 跳动动画时长，须与 wxss 中 @keyframes metric-bump 的时长一致 */
const BUMP_DURATION_MS = 450

const prevMetrics = new WeakMap<object, BumpBaseline>()
const bumpTimers = new WeakMap<object, ReturnType<typeof setTimeout>>()

Component({
  properties: {
    section: { type: Object, value: {} as MarketSection },
    compact: { type: Boolean, value: false },
    /** 是否为页面第一个卡片：收紧顶部间距，避免离页面顶部过远 */
    first: { type: Boolean, value: false },
    theme: { type: String, value: 'light' },
  },
  data: {
    bumpMap: {} as Record<string, boolean>,
    tipVisible: false,
  },
  observers: {
    section(section: MarketSection) {
      this.triggerBump(section)
    },
  },
  lifetimes: {
    attached() {
      this.setData({ theme: getTheme() })
      bindTheme(this)
    },
    detached() {
      unbindTheme(this)
      prevMetrics.delete(this)
      const timer = bumpTimers.get(this)
      if (timer) clearTimeout(timer)
      bumpTimers.delete(this)
    },
  },
  methods: {
    /** 对比本次与上次的指标值，标记发生变化的指标并触发一次跳动动画 */
    triggerBump(section: MarketSection) {
      const metrics = (section?.metrics ?? []) as MarketMetric[]
      // 面板内 Tab（如行业板块 A股 / 美股）：基线按 Tab 分组，切换 Tab 后只重建基线不做动画
      const tabKey = section?.activeTab ?? ''
      const prev = prevMetrics.get(this)
      const baseline = prev && prev.tabKey === tabKey ? prev.snapshots : null
      const snapshots = new Map<string, MetricSnapshot>()
      const bumpMap: Record<string, boolean> = {}

      for (const metric of metrics) {
        snapshots.set(metric.id, { value: metric.value, change: metric.change })
        const before = baseline?.get(metric.id)
        // 首次渲染只记录基线，不做动画
        if (before && (before.value !== metric.value || before.change !== metric.change)) {
          bumpMap[metric.id] = true
        }
      }
      prevMetrics.set(this, { tabKey, snapshots })

      if (Object.keys(bumpMap).length === 0) return

      this.setData({ bumpMap })
      const existing = bumpTimers.get(this)
      if (existing) clearTimeout(existing)
      bumpTimers.set(
        this,
        setTimeout(() => {
          this.setData({ bumpMap: {} })
          bumpTimers.delete(this)
        }, BUMP_DURATION_MS),
      )
    },
    onTipTap() {
      if (this.data.section?.tip) {
        // 埋点：点击「i」图标打开说明弹窗，上报所属分区（标题）
        trackEvent('tip.open', this.data.section.title)
        this.setData({ tipVisible: true })
      }
    },
    onCloseTip() {
      this.setData({ tipVisible: false })
    },
    /**
     * 面板内 Tab 切换（如行业板块「A股 / 美股」）：本组件**不持有**选中态，只把点击冒泡出去
     * （tabtap → components/market-page → 页面 handler），由页面 / store 决定选中并重新投影数据
     * （见 utils/market-page-factory.ts onSectionTabTap）——卡片、阶段胶囊与分享海报因此口径一致，
     * 组件自身保持无状态、可复用。
     */
    onTabTap(event: WechatMiniprogram.TouchEvent) {
      const key = String(event.currentTarget.dataset.key ?? '')
      const sectionId = this.data.section?.id ?? ''
      if (!key || !sectionId) return
      this.triggerEvent('tabtap', { sectionId, key })
    },
    onMetricTap(event: WechatMiniprogram.TouchEvent) {
      const index = event.currentTarget.dataset.index as number | undefined
      if (index === undefined) return
      // 取的是**当前选中 Tab 的投影结果**（section.metrics 恒为选中 Tab 的指标，见 types/market.ts）
      const metric = this.data.section?.metrics?.[index]
      if (metric) this.triggerEvent('metrictap', { metric })
    },
  },
})
