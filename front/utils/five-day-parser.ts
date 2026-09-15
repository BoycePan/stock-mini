/**
 * 五日分时（多日分钟线）响应解析纯函数（可单测，不依赖 wx 运行时）。
 *
 * 背景：东财 `trends2` 的 `ndays=5` 在 push2 / push2delay **两个节点都被静默忽略**——实测
 * 与 `ndays=1` 返回完全相同的当日行数（1.000001=241 行、100.DJIA=391 行），因此「五日」
 * 必须另有数据源（见 utils/minute.ts 的兜底链）：
 *   1. 腾讯 `appstock/app/dayus/query` —— 美股指数 / 美股个股 ETF，最近 5 个交易日 × 1 分钟；
 *   2. 腾讯 `appstock/app/day/query` —— A股 / 港股 / A股指数，最近 5 个交易日 × 1 分钟；
 *   3. 新浪 A股 5 分钟 K 线（scale=5，240 根 ≈ 5 个交易日）；
 *   4. 东财 push2 trends2 ndays=5（兜底尝试，实测不生效）。
 *
 * 腾讯 day/query 与 dayus/query 出参结构相同：
 * `{"data":{"sh600519":{"data":[{"date":"20260914","data":["0930 1277.27 133 16987691.06", …]}, …]}}}`
 * - 日序为**由新到旧**（需反转为时间升序）；
 * - A股 / 港股每行 `HHmm 现价 累计成交量(手) 累计成交额(元)`：**第 3/4 列是累计值**（实测 15:30 行
 *   16573 手 × 100 × 1277.96 ≈ 21.17 亿元，与第 4 列一致），故单分钟量按相邻累计值差分；
 *   均价（黄色均价线）优先按真实成交额推算（额 ÷ 量，「手 / 股」两种量纲都试，
 *   见 fiveDayAvg），指数这类换算不成立的标的退化为成交量加权近似；
 * - 美股（dayus）每行只有 3 列 `HHmm 现价 累计成交量`（无累计额）→ 单分钟量仍按累计差分，
 *   均价取成交量加权近似（用分钟价代表该分钟成交价），时间口径为交易所本地时钟 09:30-16:00 ET。
 */

import type { MinutePoint, MinuteResult } from '../types/stock'
import { shortTime } from './minute-parser'

/** 一个自然日的行集合（腾讯 day/query 的一天） */
interface TencentDayBlock {
  date?: string
  data?: string[]
}

interface TencentFiveDayNode {
  data?: TencentDayBlock[] | string[]
  qt?: Record<string, unknown[]>
}

interface TencentFiveDayBody {
  code?: number
  data?: Record<string, TencentFiveDayNode | unknown>
}

/**
 * 解析腾讯「五日」（day/query）出参 → MinuteResult。
 * preClose 取窗口首点价格（五日图以区间首点为 0% 基准，与数据源无关，口径统一）。
 */
export function parseTencentFiveDay(body: TencentFiveDayBody | undefined): MinuteResult | null {
  const node = firstNode(body?.data)
  const blocks = Array.isArray(node?.data) ? (node?.data as TencentDayBlock[]) : []
  if (!blocks.length) return null

  const points: MinutePoint[] = []
  // 日序由新到旧 → 反转成时间升序，保证 x 轴自左向右推进
  for (const block of [...blocks].reverse()) {
    const date = formatDay(block?.date)
    const rows = Array.isArray(block?.data) ? block.data : []
    let prevVolume = 0
    let prevAmount = 0
    // 当日累计量 / 累计「分钟价 × 分钟量」：无成交额口径时用于近似均价（按日归零重算）
    let dayVolume = 0
    let dayWeighted = 0
    for (const row of rows) {
      const fields = String(row).split(' ')
      if (fields.length < 3) continue
      const time = shortTime(fields[0] ?? '')
      const price = Number(fields[1])
      const cumVolume = Number(fields[2])
      const cumAmount = Number(fields[3])
      if (!time || !Number.isFinite(price) || price <= 0) continue
      const volume =
        Number.isFinite(cumVolume) && cumVolume >= prevVolume ? cumVolume - prevVolume : 0
      const amount =
        Number.isFinite(cumAmount) && cumAmount >= prevAmount ? cumAmount - prevAmount : 0
      prevVolume = Number.isFinite(cumVolume) ? cumVolume : prevVolume
      prevAmount = Number.isFinite(cumAmount) ? cumAmount : prevAmount
      dayVolume += volume
      dayWeighted += price * volume
      points.push({
        time,
        timeFull: date ? `${date} ${time}` : undefined,
        price,
        avg: fiveDayAvg(price, cumVolume, cumAmount, dayVolume, dayWeighted),
        volume,
        amount: amount > 0 ? amount : undefined,
      })
    }
  }
  if (points.length < 2) return null
  return { preClose: points[0]?.price ?? null, points }
}

/**
 * 五日均价线（黄色均线）取值：
 * 1. **真实成交额口径**（A股 / 港股 day-query 行自带累计成交额）→ 额 ÷ 量：
 *    A股的量是「手」（×100）、港股 / 美股式是「股」，两种都试，用「落在现价 0.5~2 倍区间」
 *    筛出正确的那一个（A股个股命中手口径、港股命中股口径）；
 * 2. **无成交额口径**（美股 dayus 行只有 3 列）或口径换算不成立（**指数**没有「每股价格」
 *    概念，额 / 量与指数点位无关）→ 退化为「分钟价 × 分钟量」的成交量加权均价，
 *    即当日成交重心（指数分时图的均价线也是这个含义：看现价相对成交重心的位置），
 *    页面口径提示会说明这是近似值；
 * 3. 完全没有量 → null，此时只画价格线、不出均价线。
 */
function fiveDayAvg(
  price: number,
  cumVolume: number,
  cumAmount: number,
  dayVolume: number,
  dayWeighted: number,
): number | null {
  const plausible = (value: number): boolean =>
    Number.isFinite(value) && value > 0 && value >= price * 0.5 && value <= price * 2
  if (Number.isFinite(cumVolume) && cumVolume > 0 && Number.isFinite(cumAmount) && cumAmount > 0) {
    const perShare = cumAmount / cumVolume // 量 = 股（港股 / 美股）
    if (plausible(perShare)) return perShare
    const perLot = cumAmount / (cumVolume * 100) // 量 = 手（A股）
    if (plausible(perLot)) return perLot
  }
  if (dayVolume > 0 && Number.isFinite(dayWeighted)) {
    const approx = dayWeighted / dayVolume
    if (plausible(approx)) return approx
  }
  return null
}

/** data 下的首个有效节点（腾讯会附带 market / zjlx 等非证券键） */
function firstNode(data?: Record<string, unknown>): TencentFiveDayNode | null {
  if (!data) return null
  for (const value of Object.values(data)) {
    if (!value || typeof value !== 'object') continue
    const node = value as TencentFiveDayNode
    if (Array.isArray(node.data)) return node
  }
  return null
}

/** "20260914" → "2026-09-14"（无法解析返回空串，调用方退化为无日期字段） */
function formatDay(date?: string): string {
  const value = String(date ?? '')
  if (!/^\d{8}$/.test(value)) return ''
  return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`
}

/**
 * 解析新浪 A股 5 分钟 K 线（`CN_MarketData.getKLineData?scale=5&datalen=240`）。
 * 每根 5 分钟柱取收盘价作为该时点价格（五日线用），时间取结束时刻（09:35 / 09:40 …）；
 * 该端点无均价口径，avg 置 null。
 */
export function parseSinaFiveMinuteBars(rows: unknown): MinutePoint[] {
  if (!Array.isArray(rows)) return []
  const points: MinutePoint[] = []
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue
    const item = row as Record<string, unknown>
    const full = fullTime(item.day)
    const price = Number(item.close)
    if (!full || !Number.isFinite(price) || price <= 0) continue
    const volume = Number(item.volume)
    points.push({
      time: full.slice(11),
      timeFull: full,
      price,
      avg: null,
      volume: Number.isFinite(volume) && volume > 0 ? volume : 0,
    })
  }
  return points
}

/** "2026-09-08 09:35:00" → "2026-09-08 09:35"；无日期信息返回空串 */
function fullTime(value: unknown): string {
  const text = String(value ?? '')
  const match = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})/.exec(text)
  return match ? `${match[1]} ${match[2]}` : ''
}

/** 数据点覆盖多少个自然日（五日兜底链的有效性校验：单日数据视为未命中） */
export function countPointDays(points: Array<{ time: string; timeFull?: string }>): number {
  const dates = new Set<string>()
  for (const point of points) {
    const match = /^(\d{4}-\d{2}-\d{2})/.exec(point.timeFull ?? point.time ?? '')
    if (match) dates.add(match[1] as string)
  }
  return dates.size
}
