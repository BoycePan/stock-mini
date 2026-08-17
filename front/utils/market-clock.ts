/**
 * 纯时钟市场会话判定（docs/tabbar-api.md 5.2）。
 *
 * 本模块不依赖任何网络请求 / 其他模块，可直接在 Node 测试中复用。
 */

export interface MarketSession {
  phase: string
  /** A股/国内时段（决定板块数据源与金属内外盘偏好） */
  useA: boolean
  /** 美股时段 */
  useUs: boolean
  usMode: 'pre' | 'regular' | 'post' | 'off'
  label: string
  statusTone: 'active' | 'rest'
}

export interface NonferrousSession {
  useA: boolean
  label: string
  statusTone: 'active' | 'rest'
}

/** 北京时间（UTC+8）的日期部件，与设备时区无关 */
function beijingParts(date: Date): {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  weekday: number
} {
  const bj = new Date(date.getTime() + 8 * 3600 * 1000)
  return {
    year: bj.getUTCFullYear(),
    month: bj.getUTCMonth(),
    day: bj.getUTCDate(),
    hour: bj.getUTCHours(),
    minute: bj.getUTCMinutes(),
    weekday: bj.getUTCDay(),
  }
}

export type AStockPhase = 'pre' | 'morning' | 'lunch' | 'afternoon' | 'closed'

/** A股阶段（北京时间）：集合竞价 / 早盘 / 午休 / 下午 / 休市 */
export function getAStockPhase(now: Date = new Date()): AStockPhase {
  const { weekday, hour, minute } = beijingParts(now)
  if (weekday === 0 || weekday === 6) return 'closed'
  const minutes = hour * 60 + minute
  if (minutes >= 9 * 60 + 15 && minutes < 9 * 60 + 30) return 'pre'
  if (minutes >= 9 * 60 + 30 && minutes < 11 * 60 + 30) return 'morning'
  if (minutes >= 11 * 60 + 30 && minutes < 13 * 60) return 'lunch'
  if (minutes >= 13 * 60 && minutes < 15 * 60) return 'afternoon'
  return 'closed'
}

export function isAStockTradingDay(now: Date = new Date()): boolean {
  return beijingParts(now).weekday !== 0 && beijingParts(now).weekday !== 6
}

/** 该年某月第 nth 个周日的 UTC 毫秒（month: 0-11） */
function nthSunday(year: number, month: number, nth: number): number {
  const first = new Date(Date.UTC(year, month, 1))
  const firstSunday = 1 + ((7 - first.getUTCDay()) % 7)
  return Date.UTC(year, month, firstSunday + (nth - 1) * 7)
}

/** 美东夏令时：3 月第二个周日 ~ 11 月第一个周日 */
export function isUsDst(date: Date): boolean {
  const year = date.getUTCFullYear()
  const start = nthSunday(year, 2, 2)
  const end = nthSunday(year, 10, 1)
  const day = Date.UTC(year, date.getUTCMonth(), date.getUTCDate())
  return day >= start && day < end
}

/** 美东时间（ET）的日期部件 */
function etParts(date: Date): { hour: number; minute: number; weekday: number } {
  const offset = isUsDst(date) ? -4 : -5
  const et = new Date(date.getTime() + offset * 3600 * 1000)
  return {
    hour: et.getUTCHours(),
    minute: et.getUTCMinutes(),
    weekday: et.getUTCDay(),
  }
}

export type UsPhase = 'pre' | 'regular' | 'post' | 'off'

/** 美股阶段（美东时间）：盘前 04:00-09:30 / 盘中 09:30-16:00 / 盘后 16:00-20:00 */
export function getUsPhase(now: Date = new Date()): UsPhase {
  const { weekday, hour, minute } = etParts(now)
  if (weekday === 0 || weekday === 6) return 'off'
  const minutes = hour * 60 + minute
  if (minutes >= 4 * 60 && minutes < 9 * 60 + 30) return 'pre'
  if (minutes >= 9 * 60 + 30 && minutes < 16 * 60) return 'regular'
  if (minutes >= 16 * 60 && minutes < 20 * 60) return 'post'
  return 'off'
}

const A_PHASE_LABEL: Record<AStockPhase, string> = {
  pre: 'A股集合竞价',
  morning: 'A股盘中',
  lunch: 'A股午休',
  afternoon: 'A股盘中',
  closed: 'A股休市',
}

const US_PHASE_LABEL: Record<UsPhase, string> = {
  pre: '美股盘前',
  regular: '美股盘中',
  post: '美股盘后',
  off: '美股休市',
}

/** 纯时钟会话（全球页） */
export function getMarketSession(now: Date = new Date()): MarketSession {
  const aPhase = getAStockPhase(now)
  const usPhase = getUsPhase(now)
  const useA = aPhase === 'morning' || aPhase === 'afternoon' || aPhase === 'lunch'
  const useUs = usPhase === 'pre' || usPhase === 'regular' || usPhase === 'post'
  const label = `${A_PHASE_LABEL[aPhase]} · ${US_PHASE_LABEL[usPhase]}`
  return {
    phase: label,
    useA,
    useUs,
    usMode: usPhase,
    label,
    statusTone: useA || useUs ? 'active' : 'rest',
  }
}

/** 纯时钟会话（有色页）：A股盘中 → 优先国内盘，否则外盘 */
export function getNonferrousMarketSession(now: Date = new Date()): NonferrousSession {
  const aPhase = getAStockPhase(now)
  const useA = aPhase === 'morning' || aPhase === 'afternoon' || aPhase === 'lunch'
  const usPhase = getUsPhase(now)
  return {
    useA,
    label: useA ? '国内盘' : '外盘',
    statusTone: useA || usPhase !== 'off' ? 'active' : 'rest',
  }
}
