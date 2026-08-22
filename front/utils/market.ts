import type { MarketMetric } from '../types/market'
import { formatChange } from './formatter'

export function metricViewModel(metric: MarketMetric) {
  return {
    ...metric,
    // 涨跌幅缺失（hideChange）时整个徽标由 WXML 隐藏；真实为 0% 时正常展示「0%」，
    // 不把 0 特殊处理成「— / --」（0 是合法行情，formatChange(0) = '0%'）。
    changeText: formatChange(metric.change),
    changeClass: metric.change > 0 ? 'up' : metric.change < 0 ? 'down' : 'flat',
    // 涨/跌箭头；平盘不加符号（避免「— 0%」这种怪样式）
    direction: metric.change > 0 ? '▲' : metric.change < 0 ? '▼' : '',
  }
}
