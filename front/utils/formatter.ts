import dayjs from 'dayjs'

/** 剔除字符串中的内部空格，并裁切末尾无意义的 .00 或尾随 0 */
export function stripTrailingZeros(value: string): string {
  if (!value || typeof value !== 'string') return value
  const cleaned = value.replace(/\s+/g, '')
  if (cleaned.includes('.')) {
    return cleaned.replace(/\.?0+$/, '')
  }
  return cleaned
}

export function formatChange(change: number): string {
  if (!Number.isFinite(change)) return '--'
  const sign = change > 0 ? '+' : ''
  const fixed = Math.abs(change) < 0.0001 && change !== 0 ? change.toFixed(4) : change.toFixed(2)
  const stripped = stripTrailingZeros(fixed)
  return `${sign}${stripped === '' ? '0' : stripped}%`
}

export function formatNumber(value: number, digits = 2): string {
  if (!Number.isFinite(value)) return '--'
  const fixed = value.toFixed(digits)
  const stripped = stripTrailingZeros(fixed)
  return stripped === '' ? '0' : stripped
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

/** 完整时间戳 yyyy-MM-dd HH:mm:ss（用于「数据更新时间」展示） */
export function formatDateTime(value?: string | number | Date): string {
  const date = dayjs(value)
  return date.isValid() ? date.format('YYYY-MM-DD HH:mm:ss') : ''
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
