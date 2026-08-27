/**
 * 美股市值TOP100 外部接口（纯前端直连东财延迟行情，docs/us-top100-api.md）。
 *
 * 与首页行情同域（push2delay.eastmoney.com，已在小程序合法域名内）：
 *   clist/get 排名接口，fs=m:105,m:106,m:107 + fid=f20 按总市值降序，
 *   pz=100 单页即完整前100，原样按东财排名展示。
 */

import type { UsTopStock } from '../types/quote'
import { requestExternal } from './external'
import { parseUsTop100, type EastmoneyClistBody } from '../utils/us-stocks'

const HOSTS = {
  /** 东财延迟行情（与首页报价同域 push2delay，已在小程序合法域名内） */
  eastmoney: 'https://push2delay.eastmoney.com',
} as const

/**
 * 拉取美股市值TOP100（东财原始排名，市值降序）。
 * 请求失败降级为空数组（由页面展示错误 + 重试）。
 */
export async function fetchUsTop100(): Promise<UsTopStock[]> {
  const params = [
    'pn=1',
    'pz=100',
    'po=1',
    'np=1',
    'fltt=2',
    'invt=2',
    'fid=f20',
    'fs=m:105,m:106,m:107',
    'fields=f12,f13,f14,f2,f3,f4,f20',
  ].join('&')
  const url = `${HOSTS.eastmoney}/api/qt/clist/get?${params}`
  try {
    const body = await requestExternal<EastmoneyClistBody>(url, { timeout: 10000 })
    return parseUsTop100(body)
  } catch (error) {
    console.warn('[us-top100] 东财美股排行榜请求失败:', error)
    return []
  }
}
