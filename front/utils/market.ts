import type { MarketMetric } from '../types/market'
import { formatChange } from './formatter'

export type ChangeTone = 'up' | 'down' | 'flat'

/**
 * 涨跌方向展示的统一判定：箭头 / 着色必须与「最终展示文本」保持一致。
 *
 * formatChange 会把 |change| 小于 0.005 的值四舍五入显示成「0% / +0% / -0%」，
 * 若仍按原始数值符号着色，就会出现「文本明明是 0%，却按涨/跌标成红/绿、还带箭头」的
 * 自相矛盾（例如 change = 0.004 → 「+0%」却标红，change = -0.004 → 「-0%」却标绿）。
 *
 * 这里一律以「展示是否为 0%」为准：显示为 0% 时按平盘（flat）处理，并把文本归一化为「0%」，
 * 避免表格里出现「+0% / -0%」这类易被误读的写法。
 */
export function computeChangeView(change: number | null | undefined) {
  const num = typeof change === 'number' && Number.isFinite(change) ? change : Number.NaN
  const raw = formatChange(num)
  const isFlat = /^[-+]?0%$/.test(raw)
  const isUp = !isFlat && num > 0
  const isDown = !isFlat && num < 0
  return {
    changeText: isFlat ? '0%' : raw,
    changeClass: (isUp ? 'up' : isDown ? 'down' : 'flat') as ChangeTone,
    direction: isUp ? '▲' : isDown ? '▼' : '',
  }
}

export function metricViewModel(metric: MarketMetric) {
  return {
    ...metric,
    ...computeChangeView(metric.change),
  }
}
