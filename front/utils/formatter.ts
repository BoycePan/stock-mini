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

/**
 * 行情条目更新时间（精确到分）：当天只显示「HH:mm 更新」，跨天补日期「MM-DD HH:mm 更新」，
 * 避免金店金价这类日频数据把昨天的报价误读成今天。非法时间返回空串（不渲染）。
 */
export function formatItemUpdatedAt(value?: string | number | Date): string {
  if (value === undefined || value === null || value === '') return ''
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const now = new Date()
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  const hm = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
  if (sameDay) return `${hm} 更新`
  const md = `${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
  return `${md} ${hm} 更新`
}

/**
 * 新闻时间展示：解析「yyyy-MM-dd HH:mm[:ss]」格式，
 * 当天显示「x分钟前 / x小时前」，跨天显示「MM-DD HH:mm」，跨年补年份；
 * 时间晚于当前（时钟偏差）按「刚刚」处理。解析失败返回原文。
 */
export function formatNewsTime(value: string, now = new Date()): string {
  if (!value) return ''
  const matched = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/.exec(value.trim())
  if (!matched) return value
  const [, year, month, day, hour, minute] = matched
  const date = new Date(+year!, +month! - 1, +day!, +hour!, +minute!)
  if (Number.isNaN(date.getTime())) return value
  const diff = now.getTime() - date.getTime()
  if (diff < 60_000) return '刚刚'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}分钟前`
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  if (sameDay) return `${Math.floor(diff / 3_600_000)}小时前`
  const hm = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
  const md = `${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
  if (date.getFullYear() === now.getFullYear()) return `${md} ${hm}`
  return `${year}-${md} ${hm}`
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
