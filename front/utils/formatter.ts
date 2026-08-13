export function formatChange(change: number): string {
  const sign = change > 0 ? '+' : ''
  return `${sign}${change.toFixed(2)}%`
}

export function formatNumber(value: number, digits = 2): string {
  return Number.isFinite(value) ? value.toFixed(digits) : '--'
}

export function formatWan(value: number): string {
  if (!Number.isFinite(value)) return '--'
  return `${(value / 10000).toFixed(2)}万`
}

export function formatVolume(value: number): string {
  if (!Number.isFinite(value)) return '--'
  if (value >= 100000000) return `${(value / 100000000).toFixed(2)}亿`
  if (value >= 10000) return `${(value / 10000).toFixed(2)}万`
  return String(value)
}

export function formatUpdatedAt(value = new Date()): string {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return '刚刚更新'
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')} 更新`
}

export function calculatePercentChange(current: number, previous?: number): number | null {
  if (
    !Number.isFinite(current) ||
    previous === undefined ||
    !Number.isFinite(previous) ||
    previous === 0
  ) {
    return null
  }
  return ((current - previous) / previous) * 100
}
