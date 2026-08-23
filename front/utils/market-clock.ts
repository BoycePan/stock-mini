/**
 * 纯时钟市场会话判定（docs/tabbar-api.md 5.2）。
 *
 * 本模块不发起任何网络请求，可直接在 Node 测试中复用。
 * 节假日日历为静态配置（config/holidays.ts，需每年更新）。
 */

import { MARKET_HOLIDAYS, US_EARLY_CLOSE, type MarketRegion } from '../config/holidays'

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

// ---------------------------------------------------------------------------
// 行业板块数据源 / 盘面阶段（全球页「行业板块」分区）
// ---------------------------------------------------------------------------

export interface IndustryPhase {
  /** 展示文案：大A盘中 / 午间休市 / 待盘前 / 美股盘前 / 美股盘中 / 美股盘后 / 休市 */
  label: string
  /** 展示色调：active=盘中 / quiet=盘前盘后午休等 / rest=休市 */
  tone: 'active' | 'quiet' | 'rest'
}

/**
 * 行业板块是否取 A 股数据源（对齐参考项目 resolveIndustryUseA 语义，docs/美股盘前板块展示分析与改造方案.md 改动 1）：
 * - 显式会话（useA/useUs 二选一为真且一致）时直接采用；
 * - 否则回退纯时钟窗口：工作日 09:30–15:00（含午休）+ 待盘前窗口
 *   （15:00–美股盘前开始，夏令时 16:00 / 冬令时 17:00）→ A 股板块；
 *   其余（美股盘前/盘中/盘后、周末、夜间空档）→ 美股代理股涨跌幅均值。
 */
export function resolveIndustryUseA(
  session: Pick<MarketSession, 'useA' | 'useUs'> | null,
  now: Date = new Date(),
): boolean {
  if (session && session.useA && !session.useUs) return true
  if (session && !session.useA && session.useUs) return false
  const parts = beijingParts(now)
  const workday = parts.weekday >= 1 && parts.weekday <= 5
  const minutes = parts.hour * 60 + parts.minute
  if (workday && minutes >= 570 && minutes < 900) return true // 09:30–15:00 A 股时段（含午休）
  const preStart = isUsDst(now) ? 960 : 1020
  if (workday && minutes >= 900 && minutes < preStart) return true // 待盘前窗口（对齐 ashare_post）
  return false
}

/** 行业板块盘面阶段（与数据源口径一致：A 股板块 → A 股阶段；美股代理 → 美股阶段） */
export function resolveIndustryPhase(
  session: Pick<MarketSession, 'useA' | 'useUs' | 'usMode'> | null,
  now: Date = new Date(),
): IndustryPhase {
  if (resolveIndustryUseA(session, now)) {
    const aPhase = getAStockPhase(now)
    if (aPhase === 'morning' || aPhase === 'afternoon') {
      return { label: '大A盘中', tone: 'active' }
    }
    if (aPhase === 'lunch') {
      return { label: '午间休市', tone: 'quiet' }
    }
    return { label: '待盘前', tone: 'rest' }
  }
  const usMode = session?.usMode ?? getUsPhase(now)
  switch (usMode) {
    case 'pre':
      return { label: '美股盘前', tone: 'quiet' }
    case 'regular':
      return { label: '美股盘中', tone: 'active' }
    case 'post':
      return { label: '美股盘后', tone: 'quiet' }
    default:
      return { label: '休市', tone: 'rest' }
  }
}

// ---------------------------------------------------------------------------
// 四地市场盘面状态（A股 / 美股 / 日股 / 韩股），供板块标题右侧状态胶囊使用。
// 节假日日历见 config/holidays.ts（每年更新），判定以各市场本地日期+时间为准。
// ---------------------------------------------------------------------------

export type { MarketRegion } from '../config/holidays'

export type RegionStatusKind = 'auction' | 'open' | 'break' | 'pre' | 'post' | 'closed'

export interface RegionStatus {
  kind: RegionStatusKind
  /** 展示文案：盘中 / 午休 / 盘前 / 盘后 / 集合竞价 / 休市 */
  label: string
  /** 展示色调：active=盘中(绿) / quiet=盘前盘后午休等(蓝) / rest=休市(灰) */
  tone: 'active' | 'quiet' | 'rest'
}

/** 各市场固定/动态 UTC 偏移（小时）：US 随夏令时切换，cn=北京、jp/kr=东九区 */
function regionOffset(region: MarketRegion, date: Date): number {
  if (region === 'us') return isUsDst(date) ? -4 : -5
  if (region === 'cn') return 8
  return 9
}

/** 指定固定偏移时区下的本地日期部件（与设备时区无关） */
function offsetParts(
  date: Date,
  offsetHours: number,
): { year: number; month: number; day: number; hour: number; minute: number; weekday: number } {
  const local = new Date(date.getTime() + offsetHours * 3600 * 1000)
  return {
    year: local.getUTCFullYear(),
    month: local.getUTCMonth(),
    day: local.getUTCDate(),
    hour: local.getUTCHours(),
    minute: local.getUTCMinutes(),
    weekday: local.getUTCDay(),
  }
}

function pad2(value: number): string {
  return value < 10 ? `0${value}` : String(value)
}

/** 本地日期键（YYYY-MM-DD），用于节假日日历比对 */
function localDateKey(parts: { year: number; month: number; day: number }): string {
  return `${parts.year}-${pad2(parts.month + 1)}-${pad2(parts.day)}`
}

/** 是否落在已维护的节假日日历中（仅覆盖有数据的年份；未覆盖年份返回 false，回退到周末判定） */
export function isMarketHoliday(region: MarketRegion, now: Date = new Date()): boolean {
  const parts = offsetParts(now, regionOffset(region, now))
  const key = localDateKey(parts)
  const byYear = MARKET_HOLIDAYS[region][parts.year]
  return byYear !== undefined && byYear.includes(key)
}

/** 是否交易日：非周末且非节假日（未维护年份仅按周末判定） */
export function isMarketTradingDay(region: MarketRegion, now: Date = new Date()): boolean {
  const parts = offsetParts(now, regionOffset(region, now))
  if (parts.weekday === 0 || parts.weekday === 6) return false
  return !isMarketHoliday(region, now)
}

const REST: RegionStatus = { kind: 'closed', label: '休市', tone: 'rest' }

/**
 * 四地市场盘面状态：
 * - cn：集合竞价 09:15-09:30 / 盘中 09:30-11:30 + 13:00-15:00 / 午休 11:30-13:00；
 * - us：盘前 04:00-09:30 / 盘中 09:30-16:00 / 盘后 16:00-20:00（美东时间；
 *       半日市 13:00 收盘，见 US_EARLY_CLOSE）；
 * - jp：盘中 09:00-11:30 + 12:30-15:30 / 午休 11:30-12:30（东京时间；
 *       2024-11-05 起收盘延至 15:30，午休保留）；
 * - kr：盘中 09:00-15:30（首尔时间，无午休）。
 */
export function getRegionStatus(region: MarketRegion, now: Date = new Date()): RegionStatus {
  const parts = offsetParts(now, regionOffset(region, now))
  if (parts.weekday === 0 || parts.weekday === 6) return REST
  if (isMarketHoliday(region, now)) return REST
  const minutes = parts.hour * 60 + parts.minute

  switch (region) {
    case 'cn':
      if (minutes >= 9 * 60 + 15 && minutes < 9 * 60 + 30) {
        return { kind: 'auction', label: '集合竞价', tone: 'quiet' }
      }
      if (minutes >= 9 * 60 + 30 && minutes < 11 * 60 + 30) {
        return { kind: 'open', label: '盘中', tone: 'active' }
      }
      if (minutes >= 11 * 60 + 30 && minutes < 13 * 60) {
        return { kind: 'break', label: '午休', tone: 'quiet' }
      }
      if (minutes >= 13 * 60 && minutes < 15 * 60) {
        return { kind: 'open', label: '盘中', tone: 'active' }
      }
      return REST

    case 'us': {
      const key = localDateKey(parts)
      const earlyClose = US_EARLY_CLOSE[parts.year]?.includes(key) ?? false
      const regularEnd = earlyClose ? 13 * 60 : 16 * 60
      if (minutes >= 4 * 60 && minutes < 9 * 60 + 30) {
        return { kind: 'pre', label: '盘前', tone: 'quiet' }
      }
      if (minutes >= 9 * 60 + 30 && minutes < regularEnd) {
        return { kind: 'open', label: '盘中', tone: 'active' }
      }
      if (!earlyClose && minutes >= 16 * 60 && minutes < 20 * 60) {
        return { kind: 'post', label: '盘后', tone: 'quiet' }
      }
      return REST
    }

    case 'jp':
      if (minutes >= 9 * 60 && minutes < 11 * 60 + 30) {
        return { kind: 'open', label: '盘中', tone: 'active' }
      }
      if (minutes >= 11 * 60 + 30 && minutes < 12 * 60 + 30) {
        return { kind: 'break', label: '午休', tone: 'quiet' }
      }
      if (minutes >= 12 * 60 + 30 && minutes < 15 * 60 + 30) {
        return { kind: 'open', label: '盘中', tone: 'active' }
      }
      return REST

    case 'kr':
      if (minutes >= 9 * 60 && minutes < 15 * 60 + 30) {
        return { kind: 'open', label: '盘中', tone: 'active' }
      }
      return REST
  }
}
