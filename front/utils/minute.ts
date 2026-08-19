/**
 * 当日分时多源兜底链（东财 → 腾讯 → Yahoo），与首页行情「新浪 → 腾讯 → 东财」同思路。
 * 页面层只依赖本模块：传入首页卡片 code，返回归一化的分时数据与命中的源。
 */

import type { MinuteResult } from '../types/stock'
import { minuteApi } from '../api/minute'
import { resolveMinuteSources, type MinuteSources } from '../config/minute'
import { MIN_MINUTE_POINTS } from './minute-parser'

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

/** 该卡片 code 是否支持当日分时图（任一源可用，供卡片「分时」角标展示） */
export { hasMinuteSources } from '../config/minute'

/**
 * 依次尝试 东财 → 腾讯 → Yahoo 拉取当日分时，命中即返回。
 * 全部失败或该 code 无任何源时返回 null（由调用方展示错误/空态）。
 */
export async function fetchMinuteData(code: string): Promise<MinuteFetchResult | null> {
  const sources = resolveMinuteSources(code)
  if (!sources) return null

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

export type { MinuteSources }
