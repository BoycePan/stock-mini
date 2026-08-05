import type { MarketMetric } from '../types/market'
import { formatChange } from './formatter'

export function metricViewModel(metric: MarketMetric) {
  return {
    ...metric,
    changeText: metric.change === 0 ? '—' : formatChange(metric.change),
    changeClass: metric.change > 0 ? 'up' : metric.change < 0 ? 'down' : 'flat',
    direction: metric.change > 0 ? '▲' : metric.change < 0 ? '▼' : '—',
  }
}
