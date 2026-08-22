import type { MarketMetric, MarketSection } from '../../types/market'
import { bindTheme, getTheme, unbindTheme } from '../../utils/theme'

/** 用于对比两次刷新之间单个指标是否变化的快照 */
interface MetricSnapshot {
  value: string
  change: number
}

/** 跳动动画时长，须与 wxss 中 @keyframes metric-bump 的时长一致 */
const BUMP_DURATION_MS = 450

const prevMetrics = new WeakMap<object, Map<string, MetricSnapshot>>()
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
      const snapshot = new Map<string, MetricSnapshot>()
      const bumpMap: Record<string, boolean> = {}
      const prev = prevMetrics.get(this)

      for (const metric of metrics) {
        snapshot.set(metric.id, { value: metric.value, change: metric.change })
        const before = prev?.get(metric.id)
        // 首次渲染只记录基线，不做动画
        if (before && (before.value !== metric.value || before.change !== metric.change)) {
          bumpMap[metric.id] = true
        }
      }
      prevMetrics.set(this, snapshot)

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
        this.setData({ tipVisible: true })
      }
    },
    onCloseTip() {
      this.setData({ tipVisible: false })
    },
    onMetricTap(event: WechatMiniprogram.TouchEvent) {
      const index = event.currentTarget.dataset.index as number | undefined
      if (index === undefined) return
      const metric = this.data.section?.metrics?.[index]
      if (metric) this.triggerEvent('metrictap', { metric })
    },
  },
})
