/**
 * 分时图「当日交易时段」模型：
 *
 * - 有固定交易时段的标的（A股 / 美股 / 韩股 / 日股 / 印度 / 越南），把分时数据按真实时钟
 *   铺到完整时段轴上——早于收盘时，右侧未来分钟自动留白（未收盘补全空白分时图）；
 * - 休盘时间（午休等）不占空白：时间轴只含交易分钟，11:30 之后直接接 13:00；
 * - 连续交易标的（COMEX 金属、沪期货夜盘、外汇、美元指数、原油等）没有「时间还没到」的概念，
 *   维持原有拉伸绘制（continuous）。
 *
 * 时间参考系（实测，见 docs/minute-api.md）：
 * - 东财/腾讯分时返回北京时间：1.000001=09:30-15:00、100.DJIA=21:30-04:00(夏令时)、
 *   100.KS11=08:00-14:30、100.N225=08:00-14:30、100.VNINDEX=10:15-16:00、
 *   100.SENSEX=11:45-18:00（均为北京时间，随夏令时平移的仅美股时段）；
 * - Yahoo 返回 epoch，解析器已转成设备本地时区。
 *
 * 因此锚定类时段（us / kr / jp / in / vn）统一以「首个数据点时间」为锚点生成完整时段，
 * 与数据的时间参考系天然一致，也自动适配美股夏令时（EDT 首点 21:30 / EST 首点 22:30）；
 * A股为固定时段（09:30-11:30 + 13:00-15:00，无夏令时），直接用绝对时间。
 */

import { EM_US_SECID_RE, MINUTE_SOURCES } from '../config/minute'

/**
 * 交易时段类型：
 * - ashare：A股（含东财板块指数/平均股价/ETF/个股代理），固定 09:30-11:30 + 13:00-15:00
 * - us：美股/美指/美ETF（东财返回北京时间，锚定首点以适配夏令时），09:30-16:00 ET
 * - kr：韩股/韩指，09:00-15:30 KST（无午休）
 * - jp-em：日经225（东财口径，午后到 15:30 JST）；jp-yahoo：日股（Yahoo，午后到 15:00 JST）
 * - in：印度 SENSEX，09:15-15:30 IST
 * - vn：越南 VNINDEX，09:15-11:30 + 13:00-15:00 ICT
 * - continuous：连续/近似连续交易（期货夜盘、外汇、美元指数、原油等），不铺空白
 */
export type MinuteSessionKind =
  'ashare' | 'us' | 'kr' | 'jp-em' | 'jp-yahoo' | 'in' | 'vn' | 'continuous'

export interface MinuteGridSegment {
  /** 起始分钟（0..2880，含端点） */
  start: number
  /** 结束分钟（含端点） */
  end: number
  /** 该段首槽位的全局槽位下标（含此前所有段） */
  startSlot: number
}

export interface MinuteGrid {
  kind: Exclude<MinuteSessionKind, 'continuous'>
  /** 锚点分钟：A股固定 570(09:30)，锚定类 = 首个数据点分钟 */
  anchor: number
  segments: MinuteGridSegment[]
  /** 数据槽总数 = Σ(end-start+1)；休盘时间不占槽位，段与段直接相接 */
  dataSlots: number
  /** 总槽数（= dataSlots）；x 坐标 = slot / (totalSlots - 1) */
  totalSlots: number
}

/**
 * 解析 code 对应的交易时段。
 * 日股按取数口径区分（东财 N225 午后到 15:30 JST、Yahoo 日股到 15:00 JST），
 * 其余标的与数据源无关；未识别标的返回 continuous（拉伸绘制）。
 */
export function resolveMinuteSession(code: string): MinuteSessionKind {
  if (!code) return 'continuous'
  // A股：沪深代码 / 东财板块指数 BKxxxx / 平均股价 AVG / 日经ETF代理 TPX / 有色页 A股个股代理
  if (
    /^(sh|sz)\d+$/.test(code) ||
    /^BK\d+$/.test(code) ||
    code === 'AVG' ||
    code === 'TPX' ||
    code === 'TUNGSTEN' ||
    code === 'MOLY' ||
    code === 'GERMANIUM' ||
    code === 'INDIUM' ||
    code === 'ANTIMONY'
  ) {
    return 'ashare'
  }
  // 美股/美指/美ETF：usDJI / usINX / usIXIC / us-BKxxxx / TLT / SOX
  if (code.startsWith('us') || code === 'TLT' || code === 'SOX') return 'us'
  // 美股个股/ADR 直连东财 secid（105.NVDA / 106.BRK_B，见 config/minute.ts EM_US_SECID_RE）：
  // 东财返回北京时间，锚定首点自动适配夏令时，与美指 100.DJIA 同一机制
  if (EM_US_SECID_RE.test(code)) return 'us'
  if (code === 'KS11' || code === 'KQ11') return 'kr'
  if (code === 'N225') return 'jp-em'
  if (code === 'SENSEX') return 'in'
  if (code === 'VNINDEX') return 'vn'
  // 韩/日个股：用配置里的 Yahoo 符号后缀区分市场（分时源可能已是东财 177/176，
  // 但 Yahoo 符号仍保留用于识别市场，东财与 Yahoo 的韩/日时段形状一致）
  if (/^\d+$/.test(code)) {
    const symbol = MINUTE_SOURCES[code]?.yahoo ?? ''
    if (symbol.endsWith('.KS')) return 'kr'
    if (symbol.endsWith('.T')) return 'jp-yahoo'
  }
  return 'continuous'
}

/**
 * 构建完整时段网格。continuous 或无意义的 kind 返回 null（调用方回退拉伸绘制）。
 * 锚定类以 anchor（首个数据点分钟）为基准生成时段；A股忽略 anchor，用固定时段。
 */
export function buildMinuteGrid(kind: MinuteSessionKind, anchor: number): MinuteGrid | null {
  if (kind === 'continuous') return null
  // 各时段相对锚点偏移（分钟，含端点）：
  // A股 09:30-11:30 + 13:00-15:00；东财数据午后从 13:01 起（13:00 槽位留空，宽度 1 槽不可见）
  const shapes: Record<Exclude<MinuteSessionKind, 'continuous'>, Array<[number, number]>> = {
    ashare: [
      [570, 690],
      [780, 900],
    ],
    us: [[0, 390]],
    kr: [[0, 390]],
    'jp-em': [
      [0, 150],
      [210, 390],
    ],
    'jp-yahoo': [
      [0, 150],
      [210, 360],
    ],
    in: [[0, 375]],
    vn: [
      [0, 135],
      [225, 345],
    ],
  }
  const shape = shapes[kind]
  if (!shape) return null
  // A股时段本身即绝对分钟（09:30/11:30/13:00/15:00），锚定类为相对锚点偏移
  const base = kind === 'ashare' ? 0 : anchor
  const segments: MinuteGridSegment[] = []
  let startSlot = 0
  for (let i = 0; i < shape.length; i += 1) {
    const [start, end] = shape[i] as [number, number]
    if (i > 0) {
      const prev = shape[i - 1] as [number, number]
      // 休盘时间不占槽位：下一段直接从上一段末尾相接
      startSlot += prev[1] - prev[0] + 1
    }
    segments.push({ start: base + start, end: base + end, startSlot })
  }
  const dataSlots = segments.reduce((sum, seg) => sum + (seg.end - seg.start + 1), 0)
  return {
    kind,
    // 锚点仅供 minuteToSlot 跨零点判断：A股固定 09:30，锚定类 = 首个数据点分钟
    anchor: kind === 'ashare' ? 570 : anchor,
    segments,
    dataSlots,
    totalSlots: dataSlots,
  }
}

/** "HH:mm" → 分钟数（0..1439）；无法解析返回 null */
export function parseMinuteOfDay(time: string): number | null {
  const match = /^(\d{2}):(\d{2})$/.exec(time)
  if (!match) return null
  const hour = Number(match[1])
  const minute = Number(match[2])
  if (hour > 23 || minute > 59) return null
  return hour * 60 + minute
}

/**
 * 分钟 → 全局槽位下标。跨零点时段（美股 21:30→04:00 等）会把早于锚点的分钟视为次日同一时段；
 * 落在休盘时间（午休等，数据源不会产出该分钟）或时段外返回 null（调用方视为无法对齐，回退拉伸绘制）。
 */
export function minuteToSlot(grid: MinuteGrid, minute: number): number | null {
  let m = minute
  if (m < grid.anchor) m += 1440
  for (const seg of grid.segments) {
    if (m >= seg.start && m <= seg.end) return seg.startSlot + (m - seg.start)
  }
  return null
}

/** 槽位下标 → 分钟（0..1439，跨零点取模；空槽返回 null） */
export function slotToMinute(grid: MinuteGrid, slot: number): number | null {
  for (const seg of grid.segments) {
    const endSlot = seg.startSlot + (seg.end - seg.start)
    if (slot >= seg.startSlot && slot <= endSlot) {
      return (((seg.start + (slot - seg.startSlot)) % 1440) + 1440) % 1440
    }
  }
  return null
}

/** 分钟 → "HH:mm"（跨零点后自动取模，如 1680 → 04:00） */
export function minuteToTime(minute: number): string {
  const m = ((minute % 1440) + 1440) % 1440
  const hh = String(Math.floor(m / 60)).padStart(2, '0')
  const mm = String(m % 60).padStart(2, '0')
  return `${hh}:${mm}`
}

/**
 * 时段轴上 5 个时间标签：
 * - 单段：0 / 1/4 / 1/2 / 3/4 / 1
 * - 两段：段1起点 / 段1中点 / 段1终点+段2起点（合并，休盘不占空白）/ 段2中点 / 段2终点
 *   （A股 → 09:30 10:30 11:30/13:00 14:00 15:00）
 * 返回 [{ slot, text }]，x 坐标由调用方按 slot 定位。
 */
export function sessionTimeLabels(grid: MinuteGrid): Array<{ slot: number; text: string }> {
  const segs = grid.segments
  if (segs.length === 1) {
    const seg = segs[0] as MinuteGridSegment
    const len = seg.end - seg.start
    const labels: Array<{ slot: number; text: string }> = []
    for (let i = 0; i <= 4; i += 1) {
      const offset = Math.round((i / 4) * len)
      labels.push({ slot: seg.startSlot + offset, text: minuteToTime(seg.start + offset) })
    }
    return labels
  }
  const s1 = segs[0] as MinuteGridSegment
  const s2 = segs[segs.length - 1] as MinuteGridSegment
  const mid1 = s1.start + Math.floor((s1.end - s1.start) / 2)
  const mid2 = s2.start + Math.floor((s2.end - s2.start) / 2)
  return [
    { slot: s1.startSlot, text: minuteToTime(s1.start) },
    { slot: s1.startSlot + (mid1 - s1.start), text: minuteToTime(mid1) },
    {
      slot: s1.startSlot + (s1.end - s1.start),
      text: `${minuteToTime(s1.end)}/${minuteToTime(s2.start)}`,
    },
    { slot: s2.startSlot + (mid2 - s2.start), text: minuteToTime(mid2) },
    { slot: s2.startSlot + (s2.end - s2.start), text: minuteToTime(s2.end) },
  ]
}
