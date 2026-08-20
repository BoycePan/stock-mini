/**
 * 当日分时多源兜底链（东财 → 腾讯 → Yahoo），与首页行情「新浪 → 腾讯 → 东财」同思路。
 * 页面层只依赖本模块：传入首页卡片 code，返回归一化的分时数据与命中的源。
 *
 * 美股时段行业板块（us-BKxxxx）：走「代理股分时均值合成」——
 * 卡片展示的正是美股代理股涨跌幅均值，分时同样对每只代理取东财 trends2
 * （归一化到昨收 100）后逐分钟取均值（跨零点对齐，基准=昨收100），口径完全一致；
 * 标注文案中代理股给出中文名（东财名，英文名用 US_PROXY_NAMES 补充表）。
 */

import type { MinuteResult } from '../types/stock'
import { minuteApi } from '../api/minute'
import { US_PROXY_NAMES, resolveMinuteSources, type MinuteSources } from '../config/minute'
import { bareCode } from './quote-consensus'
import { buildCompositePoints, MIN_MINUTE_POINTS, type CompositeSeries } from './minute-parser'

export interface MinuteFetchResult extends MinuteResult {
  /** 命中的源：'em' | 'tc' | 'yahoo' */
  source: 'em' | 'tc' | 'yahoo'
  /** 数据来源展示文案（页面「数据来源」标签） */
  sourceLabel: string
  /** 展示提示（如代理标的说明），无则缺省 */
  note?: string
}

const SOURCE_LABELS: Record<MinuteFetchResult['source'], string> = {
  em: '东方财富分时',
  tc: '腾讯分时',
  yahoo: 'Yahoo 1分钟',
}

/** 代理股合成图的数据来源标签 */
const COMPOSITE_SOURCE_LABEL = '东方财富分时（美股代理合成）'

/** 该卡片 code 是否支持当日分时图（任一源可用，供卡片「分时」角标展示） */
export { hasMinuteSources } from '../config/minute'

/**
 * 依次尝试 东财 → 腾讯 → Yahoo 拉取当日分时，命中即返回。
 * 代理股合成源（emProxies）为独立分支：全部代理失败返回 null（由调用方展示错误/重试）。
 * 全部失败或该 code 无任何源时返回 null。
 */
export async function fetchMinuteData(code: string): Promise<MinuteFetchResult | null> {
  const sources = resolveMinuteSources(code)
  if (!sources) return null

  // 美股代理股分时均值合成（us-BKxxxx）
  if (sources.emProxies?.length) {
    const composite = await fetchCompositeMinute(sources.emProxies)
    if (!composite) return null
    return {
      ...composite.result,
      source: 'em',
      sourceLabel: COMPOSITE_SOURCE_LABEL,
      note: composite.note,
    }
  }

  const tries: Array<{ key: 'em' | 'tc' | 'yahoo'; run: () => Promise<MinuteResult | null> }> = []
  if (sources.em) {
    tries.push({ key: 'em', run: () => minuteApi.eastmoney(sources.em as string) })
  }
  if (sources.tc) {
    tries.push({ key: 'tc', run: () => minuteApi.tencent(sources.tc as string) })
  }
  if (sources.yahoo) {
    tries.push({ key: 'yahoo', run: () => minuteApi.yahoo(sources.yahoo as string) })
  }

  for (const { key, run } of tries) {
    const result = await run()
    // 点数过少视为无效（腾讯外股/空数据），继续下一源
    if (result && result.points.length >= MIN_MINUTE_POINTS) {
      return { ...result, source: key, sourceLabel: SOURCE_LABELS[key], note: sources.note }
    }
  }
  return null
}

// ---------------------------------------------------------------------------
// 美股代理股分时均值合成
// ---------------------------------------------------------------------------

interface CompositeMinuteData {
  result: MinuteResult
  /** 标注文案（含代理股中文名） */
  note: string
}

/**
 * 并发拉取每只代理股当日分时（保留完整时间戳），归一化到昨收 100 后合成均值。
 * 单只代理失败/点数不足自动跳过（部分可用即合成），全部失败返回 null。
 */
async function fetchCompositeMinute(secids: string[]): Promise<CompositeMinuteData | null> {
  const results = await Promise.all(
    secids.map((secid) => minuteApi.eastmoney(secid, { keepFullTime: true })),
  )
  const valid: Array<{
    secid: string
    name?: string
    preClose: number
    series: CompositeSeries['points']
  }> = []
  secids.forEach((secid, index) => {
    const result = results[index]
    if (
      !result ||
      result.points.length < MIN_MINUTE_POINTS ||
      !result.preClose ||
      result.preClose <= 0
    ) {
      return
    }
    valid.push({
      secid,
      name: result.name,
      preClose: result.preClose,
      series: result.points.map((p) => ({
        time: p.time,
        norm: (p.price / (result.preClose as number)) * 100,
        volume: p.volume || 0,
      })),
    })
  })
  if (!valid.length) return null

  const points = buildCompositePoints(
    valid.map((item) => ({ name: item.name, points: item.series })),
  )
  if (points.length < MIN_MINUTE_POINTS) return null

  return {
    result: { preClose: 100, points },
    note: buildCompositeNote(
      valid.map((item) => ({ ticker: bareCode(item.secid), name: item.name })),
    ),
  }
}

/**
 * 合成图标注文案：列出代理股中文名（中文名表优先，东财名兜底），最多列 4 只，
 * 其余以「等 N 只」概括；单只代理（板块 ETF）直接标注该标的。
 */
function buildCompositeNote(proxies: Array<{ ticker: string; name?: string }>): string {
  const shown = proxies.slice(0, 4)
  const head = shown.map((p) => `${proxyDisplayName(p.ticker, p.name)}(${p.ticker})`).join('、')
  if (proxies.length === 1) {
    return `由 ${head} 当日分时均值合成（基准=昨收100，与卡片口径一致）`
  }
  const tail = proxies.length > shown.length ? `等${proxies.length}只` : ''
  return `由 ${head}${tail}美股代理股当日分时均值合成（基准=昨收100，与卡片口径一致）`
}

/** 代理股展示名：中文名表优先（保证中文名），东财中文名兜底，再退回代码 */
function proxyDisplayName(ticker: string, apiName?: string): string {
  const manual = US_PROXY_NAMES[ticker]
  if (manual) return manual
  if (apiName && /[\u4e00-\u9fff]/.test(apiName)) return apiName
  return ticker
}

export type { MinuteSources }

export type MinuteVolumeDirection = 'up' | 'down' | 'flat'

/**
 * 计算分时图每分钟成交量柱的涨跌方向（用于分色）：
 * - 红柱 ('up')：该分钟最后一笔成交价 > 该分钟开盘价（即该分钟股价收涨）
 * - 绿柱 ('down')：该分钟最后一笔成交价 < 该分钟开盘价（即该分钟股价收跌）
 * - 白/灰柱 ('flat')：该分钟收盘价 = 开盘价（价格持平）
 *
 * 注：
 * - i = 0（首点）：若有昨收 preClose（>0），以昨收作为开盘基准比对；若无昨收，作为持平 'flat'
 * - i > 0：以上一分钟最后一笔成交价作为该分钟开盘价进行对比
 */
export function computeMinuteVolumeDirections(
  points: Array<{ price: number }>,
  preClose?: number | null,
): MinuteVolumeDirection[] {
  const n = points.length
  const result = new Array<MinuteVolumeDirection>(n)
  const hasPre = typeof preClose === 'number' && Number.isFinite(preClose) && preClose > 0
  for (let i = 0; i < n; i += 1) {
    const curP = points[i]?.price ?? 0
    if (i === 0) {
      if (!hasPre) {
        result[i] = 'flat'
      } else {
        const pre = preClose as number
        if (curP > pre) result[i] = 'up'
        else if (curP < pre) result[i] = 'down'
        else result[i] = 'flat'
      }
    } else {
      const prevP = points[i - 1]?.price ?? 0
      if (curP > prevP) {
        result[i] = 'up'
      } else if (curP < prevP) {
        result[i] = 'down'
      } else {
        result[i] = 'flat'
      }
    }
  }
  return result
}

