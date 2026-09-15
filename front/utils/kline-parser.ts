/**
 * K 线响应解析纯函数（可单测，不依赖 wx 运行时）。
 *
 * 覆盖三个国内直连源的日/周/月 K 线（年 K 由 utils/kline.ts 的 aggregateKlines 聚合）：
 *   1. 腾讯   web.ifzq.gtimg.cn/appstock/app/{fqkline|usfqkline|kline}/get
 *            行格式 [日期, 开盘, 收盘, 最高, 最低, 成交量, ...]（注意：第 3 列是收盘、第 4 列才是最高）
 *   2. 新浪A股 money.finance.sina.com.cn/quotes_service/api/json_v2.php/CN_MarketData.getKLineData
 *            出参 JSON 数组 [{ day, open, high, low, close, volume }]
 *   3. 新浪美股 stock.finance.sina.com.cn/usstock/api/jsonp_v2.php/.../US_MinKService.getDailyK
 *            出参 JSONP 数组 [{ d, o, h, l, c, v, a }]
 *   4. 新浪期货 stock2.finance.sina.com.cn/futures/api/jsonp.php/...（内盘 / 外盘）
 *            内盘 [{ d, o, h, l, c, v, p, s }]、外盘 [{ date, open, high, low, close, volume }]
 *   5. 新浪外汇 vip.stock.finance.sina.com.cn/forex/api/jsonp.php/.../NewForexService.getDayKLine
 *            出参为管道分隔字符串 "日期,开,低,高,收,|日期,开,低,高,收,|…"（**第 3 列是最低、第 4 列是最高**）
 *   6. 东财   push2his.eastmoney.com/api/qt/stock/kline/get（klt=101 日 / 102 周 / 103 月）
 *            出参 data.klines = ["日期,开,收,高,低,量,额,…"]，覆盖腾讯与新浪都没有的标的
 *            （A股板块指数 BKxxxx、国际指数、A股平均股价等，见 config/kline.ts）
 *
 * 统一归一化为 KlinePoint[]（时间升序、字段取正数校验），任一源解析失败返回 null，
 * 由 utils/kline-source.ts 的多源兜底链继续尝试下一源。
 */

import type { KlinePoint } from '../types/stock'

/** 少于该根数的 K 线视为无效（避免上游空数组 / 单根脏数据被当成命中） */
export const MIN_KLINE_BARS = 2

/** 通用收尾：过滤非正价格、按时间升序、同时间去重（保留最后一根），不足最小根数返回 null */
export function normalizeKlines(bars: KlinePoint[]): KlinePoint[] | null {
  const valid = bars.filter(
    (k) =>
      !!k &&
      !!k.time &&
      Number.isFinite(k.open) &&
      Number.isFinite(k.high) &&
      Number.isFinite(k.low) &&
      Number.isFinite(k.close) &&
      k.open > 0 &&
      k.close > 0 &&
      k.high > 0 &&
      k.low > 0,
  )
  if (valid.length < MIN_KLINE_BARS) return null
  valid.sort((a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : 0))
  const deduped: KlinePoint[] = []
  for (const k of valid) {
    const last = deduped[deduped.length - 1]
    if (last && last.time === k.time) {
      deduped[deduped.length - 1] = k
    } else {
      deduped.push(k)
    }
  }
  return deduped.length >= MIN_KLINE_BARS ? deduped : null
}

/** 腾讯 K 线周期参数（请求 param 的第 2 段） */
export type TencentKlineUnit = 'day' | 'week' | 'month'

interface TencentKlineBody {
  code?: number
  data?: Record<string, unknown>
}

/**
 * 解析腾讯 K 线响应。
 * data 下可能同时存在证券代码键与 market 键，代码键内部按周期给出数组：
 * 复权请求（fqkline/usfqkline）为 qfqday / qfqweek / qfqmonth，非复权为 day / week / month；
 * 两种键名都兼容（港股/美股指数等标的只返回非复权键）。
 * 行内元素可能混入对象（港股分红信息等）与非数字字符串，取前 6 位按 [日期,开,收,高,低,量] 解析。
 */
export function parseTencentKlineBody(
  body: TencentKlineBody | undefined,
  unit: TencentKlineUnit,
): KlinePoint[] | null {
  const data = body?.data
  if (!data || typeof data !== 'object') return null
  for (const value of Object.values(data)) {
    if (!value || typeof value !== 'object') continue
    const node = value as Record<string, unknown>
    const rows = (node[`qfq${unit}`] ?? node[unit]) as unknown
    if (!Array.isArray(rows) || rows.length === 0) continue
    const bars: KlinePoint[] = []
    for (const row of rows) {
      if (!Array.isArray(row) || row.length < 6) continue
      const time = String(row[0] ?? '')
      const open = Number(row[1])
      const close = Number(row[2])
      const high = Number(row[3])
      const low = Number(row[4])
      const volume = Number(row[5])
      bars.push({
        time,
        open,
        close,
        high,
        low,
        volume: Number.isFinite(volume) ? volume : 0,
      })
    }
    const normalized = normalizeKlines(bars)
    if (normalized) return normalized
  }
  return null
}

/**
 * 解析新浪 A股 K 线（JSON 数组，字段为具名字段）。
 * 请求 scale=240 为日线、scale=1680 为周线。
 */
export function parseSinaAshareKline(input: unknown): KlinePoint[] | null {
  const parsed = parseJsonLoose(input)
  if (!Array.isArray(parsed)) return null
  const bars: KlinePoint[] = []
  for (const row of parsed) {
    if (!row || typeof row !== 'object') continue
    const item = row as Record<string, unknown>
    bars.push({
      time: String(item.day ?? item.d ?? ''),
      open: Number(item.open),
      high: Number(item.high),
      low: Number(item.low),
      close: Number(item.close),
      volume: numberOrZero(item.volume),
    })
  }
  return normalizeKlines(bars)
}

/** 新浪 JSONP 出参的字段映射（同一端点族里不同市场的字段名不一致） */
export interface SinaFieldMap {
  date: string
  open: string
  high: string
  low: string
  close: string
  volume?: string
}

/** 新浪美股日 K 字段（US_MinKService.getDailyK：d/o/h/l/c/v/a） */
export const SINA_US_FIELDS: SinaFieldMap = {
  date: 'd',
  open: 'o',
  high: 'h',
  low: 'l',
  close: 'c',
  volume: 'v',
}

/** 新浪内盘期货日 K 字段（InnerFuturesNewService.getDailyKLine：d/o/h/l/c/v/p/s） */
export const SINA_INNER_FUTURES_FIELDS: SinaFieldMap = {
  date: 'd',
  open: 'o',
  high: 'h',
  low: 'l',
  close: 'c',
  volume: 'v',
}

/** 新浪外盘期货日 K 字段（GlobalFuturesService.getGlobalFuturesDailyKLine：具名全拼） */
export const SINA_GLOBAL_FUTURES_FIELDS: SinaFieldMap = {
  date: 'date',
  open: 'open',
  high: 'high',
  low: 'low',
  close: 'close',
  volume: 'volume',
}

/**
 * 解析新浪 JSONP（`var _X=([...])`）数组出参，按字段映射归一化。
 * JSONP 包裹层先剥离，再按 JSON 解析；失败返回 null。
 */
export function parseSinaJsonpKline(input: unknown, fields: SinaFieldMap): KlinePoint[] | null {
  const parsed = parseJsonLoose(input)
  if (!Array.isArray(parsed)) return null
  const bars: KlinePoint[] = []
  for (const row of parsed) {
    if (!row || typeof row !== 'object') continue
    const item = row as Record<string, unknown>
    bars.push({
      time: String(item[fields.date] ?? ''),
      open: Number(item[fields.open]),
      high: Number(item[fields.high]),
      low: Number(item[fields.low]),
      close: Number(item[fields.close]),
      volume: numberOrZero(fields.volume ? item[fields.volume] : 0),
    })
  }
  return normalizeKlines(bars)
}

/**
 * 解析东财 K 线（klt=101 日 / 102 周 / 103 月）。
 *
 * 出参 `{ data: { klines: ["2026-09-09,开,收,高,低,量,额,振幅,涨跌幅,涨跌额,换手率", …] } }`；
 * 无数据时 `data` 为 null 或 `klines` 为空数组（延迟节点 push2/push2delay 恒如此）。
 * 板块指数 / 国际指数的行字段数可能少于 11 段，故只要求 ≥ 6 段（日期 / 开 / 收 / 高 / 低 / 量），
 * 行可能是对象（个别市场带扩展信息）时跳过。
 */
export function parseEastmoneyKline(input: unknown): KlinePoint[] | null {
  const parsed = parseJsonLoose(input) as { data?: { klines?: unknown } } | null
  const rows = parsed?.data?.klines
  if (!Array.isArray(rows)) return null
  const bars: KlinePoint[] = []
  for (const row of rows) {
    if (typeof row !== 'string') continue
    const fields = row.split(',')
    if (fields.length < 6) continue
    bars.push({
      time: String(fields[0] ?? '').trim(),
      open: Number(fields[1]),
      close: Number(fields[2]),
      high: Number(fields[3]),
      low: Number(fields[4]),
      volume: numberOrZero(fields[5]),
    })
  }
  return normalizeKlines(bars)
}

/**
 * 解析新浪外汇日 K（NewForexService.getDayKLine）。
 * 出参形如 `var _K=("2014-11-07,1088.31995,1085.71997,1093.00000,1086.00000,|2014-11-10,…")`：
 * 每日 6 段，字段顺序实测为 **日期, 开盘, 最低, 最高, 收盘, 空**（该端点无成交量，量按 0 处理）。
 */
export function parseSinaForexKline(input: unknown): KlinePoint[] | null {
  const body = extractQuotedString(input)
  if (!body) return null
  const bars: KlinePoint[] = []
  for (const segment of body.split('|')) {
    const fields = segment.split(',')
    if (fields.length < 5) continue
    bars.push({
      time: String(fields[0] ?? ''),
      open: Number(fields[1]),
      low: Number(fields[2]),
      high: Number(fields[3]),
      close: Number(fields[4]),
      volume: 0,
    })
  }
  return normalizeKlines(bars)
}

/** 宽松 JSON 解析：先剥 JSONP 包裹，再取首个 '{' / '[' 到末尾匹配括号之间的内容。
 *  入参已是对象/数组时（微信对 JSON 响应可能自动解析）直接返回。 */
export function parseJsonLoose(input: unknown): unknown {
  if (input !== null && typeof input === 'object') return input
  const raw = typeof input === 'string' ? input.trim() : ''
  if (!raw) return null
  const candidates = [raw, stripJsonp(raw)]
  const firstBracket = raw.search(/[[{]/)
  if (firstBracket > 0) candidates.push(raw.slice(firstBracket))
  for (const candidate of candidates) {
    if (!candidate) continue
    try {
      return JSON.parse(candidate)
    } catch {
      // 继续尝试下一种剥离方式
    }
  }
  return null
}

/** 剥离 JSONP 包裹：`var _X=([...])` / `cb({...})` → 括号内的 JSON 文本 */
export function stripJsonp(text: string): string {
  const start = text.indexOf('(')
  const end = text.lastIndexOf(')')
  if (start >= 0 && end > start) return text.slice(start + 1, end).trim()
  return text.trim()
}

/**
 * 取 JSONP 包裹里的字符串字面量内容（新浪外汇出参为字符串而非数组）：
 * 形如 `var _X=("日期,开,低,高,收,|…");`，取首个 `"` 与末个 `"` 之间的部分
 * （尾部还有 `)` `;` 等包裹字符，因此不能要求 `"` 后紧跟分号）。
 */
function extractQuotedString(input: unknown): string | null {
  if (typeof input !== 'string') return null
  const start = input.indexOf('"')
  const end = input.lastIndexOf('"')
  if (start < 0 || end <= start) return null
  return input.slice(start + 1, end)
}

/** 数值兜底：无法解析或非有限值按 0（成交量为 0 是常态，不视为脏数据） */
function numberOrZero(value: unknown): number {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}
