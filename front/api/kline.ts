/**
 * K 线外部接口统一封装（纯前端直连国内公开行情，见 docs/minute-api.md「K 线」小节）。
 *
 * 与 api/minute.ts 同风格：单接口失败「降级为 null」而非抛错，由 utils/kline-source.ts
 * 按 东财 → 腾讯 → 新浪 兜底链补齐；年 K 无任何直连源，统一由月/周/日 K 聚合（utils/kline.ts）。
 *
 * 三个源的分工（覆盖率优先，命中即返回）：
 *   1. 东财 push2his（klt=101/102/103）：覆盖腾讯与新浪**都没有**的标的——
 *      A股板块指数 BKxxxx、国际指数（KOSPI / 日经225 / 越南 / 印度 / 费半）、A股平均股价；
 *   2. 腾讯（fqkline / usfqkline / kline）：A股 / 港股 / 日股 / 韩股 / 美股个股与指数 / 外汇，
 *      并作为美股代理股合成（美股时段行业板块）的取数源；
 *   3. 新浪（A股 / 美股 / 内盘期货 / 外盘期货 / 外汇）：腾讯无覆盖的标的与备用源。
 *
 * 为什么东财只排「无其他源」的标的：东财历史 K 线只有 push2his / 82.push2his 节点提供，
 * 延迟节点 push2delay / push2 明确返回空 klines（`{"data":{"klines":[]}}`）；
 * 该节点对异常流量（海外出口 IP、非浏览器 UA）会直接空响应，故**仅在没有腾讯/新浪源时**使用，
 * 避免已有可靠源的标的每次白等一次往返（见 docs/行情页多周期图表.md）。
 *
 * 域名：web.ifzq.gtimg.cn 已在生产 request 合法域名内（与腾讯分时同域）；
 * 新浪四个域名（money / stock / stock2 / vip.stock.finance.sina.com.cn）与
 * 东财 push2his.eastmoney.com（可选备用节点 82.push2his.eastmoney.com）为新增，见文档说明。
 */

import type { KlinePoint } from '../types/stock'
import {
  parseEastmoneyKline,
  parseSinaAshareKline,
  parseSinaForexKline,
  parseSinaJsonpKline,
  parseTencentKlineBody,
  SINA_GLOBAL_FUTURES_FIELDS,
  SINA_INNER_FUTURES_FIELDS,
  SINA_US_FIELDS,
  type TencentKlineUnit,
} from '../utils/kline-parser'
import { requestExternal } from './external'

const HOSTS = {
  /** 腾讯 K 线（与腾讯分时同域，已在合法域名白名单内） */
  tencent: 'https://web.ifzq.gtimg.cn',
  /** 东财历史 K 线主节点（板块指数 / 国际指数 / 平均股价等唯一来源；需新增合法域名） */
  emKline: 'https://push2his.eastmoney.com',
  /** 东财历史 K 线备用节点（主节点被风控空响应时轮换；未配置合法域名时该请求会立即失败，不影响主节点） */
  emKlineBackup: 'https://82.push2his.eastmoney.com',
  /** 新浪 A股 K 线 */
  sinaAshare: 'https://money.finance.sina.com.cn',
  /** 新浪美股 K 线 */
  sinaUs: 'https://stock.finance.sina.com.cn',
  /** 新浪期货 K 线（内盘 / 外盘） */
  sinaFutures: 'https://stock2.finance.sina.com.cn',
  /** 新浪外汇 / 美元指数日 K */
  sinaForex: 'https://vip.stock.finance.sina.com.cn',
} as const

/** 腾讯 K 线代码前缀 → 端点（美股走 usfqkline，其余走 fqkline；外汇 wh 前缀两者都不支持，走 kline）
 *  说明：腾讯 K 线接口一族按市场拆分端点，实测
 *  - fqkline：A股（含前复权 qfqday）/ 港股 / 日股 / 韩股 / A股与港股指数；
 *  - usfqkline：美股个股（usAAPL.OQ）与美股指数（usDJI / usINX / usIXIC / usNDX）；
 *  - kline：非复权通用端点，覆盖上面全部 + 外汇（whUSDCNY / whUSDJPY / whDINIW）。
 *  统一都支持 day / week / month 三种周期（年 K 由聚合得到）。 */
function tencentEndpoint(code: string): string {
  if (/^us/i.test(code)) return `${HOSTS.tencent}/appstock/app/usfqkline/get`
  if (/^wh/i.test(code)) return `${HOSTS.tencent}/appstock/app/kline/kline`
  return `${HOSTS.tencent}/appstock/app/fqkline/get`
}

/**
 * 腾讯日 / 周 / 月 K 线。
 * @param code 腾讯行情代码（sh600519 / sz000001 / bj920010 / hk00700 / jp7203 / kr005930 /
 *   usAAPL.OQ / usDJI / whUSDCNY）
 * @param unit 周期参数（day / week / month）
 * @param count 请求根数（上游按最近 N 根返回）
 */
export async function fetchTencentKline(
  code: string,
  unit: TencentKlineUnit,
  count: number,
): Promise<KlinePoint[] | null> {
  const endpoint = tencentEndpoint(code)
  const qfq = endpoint.includes('kline/kline') ? '' : ',qfq'
  const url = `${endpoint}?param=${encodeURIComponent(code)},${unit},,,${count}${qfq}`
  try {
    const body = await requestExternal<{ code?: number; data?: Record<string, unknown> }>(url, {
      timeout: 12000,
      referer: 'https://gu.qq.com/',
    })
    return parseTencentKlineBody(body, unit)
  } catch (error) {
    console.warn(`[kline] 腾讯 K 线失败 ${code} ${unit}:`, error)
    return null
  }
}

/** 东财 K 线周期参数（klt）：日 / 周 / 月（年 K 无直连，由聚合得到） */
export type EastmoneyKlineUnit = 'day' | 'week' | 'month'

/** 周期 → 东财 klt 取值（101 日 / 102 周 / 103 月） */
const EM_KLT: Record<EastmoneyKlineUnit, number> = { day: 101, week: 102, month: 103 }

/**
 * 东财日 / 周 / 月 K 线（板块指数 / 国际指数 / A股平均股价等腾讯与新浪都没有的标的）。
 *
 * 节点策略：主节点 push2his 命中即返回；主节点被风控空响应（连接重置 / klines 为空）时
 * 轮换 82.push2his 备用节点。两个节点都要在微信公众平台配置 request 合法域名
 * （只配主节点即可，备用节点未配置时请求立即失败、不影响主节点结果）。
 *
 * @param secid 东财 secid（如 90.BK1134 板块指数 / 100.N225 日经225 / 47.800005 A股平均股价）
 * @param unit 周期（day / week / month）
 * @param count 请求根数（lmt，上游按最近 N 根返回）
 */
export async function fetchEastmoneyKline(
  secid: string,
  unit: EastmoneyKlineUnit,
  count: number,
): Promise<KlinePoint[] | null> {
  const query =
    `secid=${encodeURIComponent(secid)}` +
    `&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61` +
    `&klt=${EM_KLT[unit]}&fqt=1&end=20500101&lmt=${Math.max(1, Math.floor(count))}`
  for (const host of [HOSTS.emKline, HOSTS.emKlineBackup]) {
    try {
      const body = await requestExternal<unknown>(`${host}/api/qt/stock/kline/get?${query}`, {
        timeout: 12000,
        referer: 'https://quote.eastmoney.com/',
      })
      const klines = parseEastmoneyKline(body)
      if (klines) return klines
    } catch (error) {
      console.warn(`[kline] 东财 K 线失败 ${secid} ${unit} ${host}:`, error)
    }
  }
  return null
}

/** 新浪 K 线端点族：A股（含周线）/ 美股 / 内盘期货 / 外盘期货 / 外汇 */
export type SinaKlineKind = 'ashare' | 'us' | 'futuresInner' | 'futuresGlobal' | 'forex'

/**
 * 新浪日 / 周 K 线（仅 A股支持周线 scale=1680，其余端点只有日线，年/月由聚合得到）。
 * @param kind 端点族
 * @param symbol 新浪代码（sh600519 / AAPL / AU0 / GC / USDKRW）
 * @param unit day=日线；week 仅 A股有效（scale=1680）
 */
export async function fetchSinaKline(
  kind: SinaKlineKind,
  symbol: string,
  unit: 'day' | 'week' = 'day',
): Promise<KlinePoint[] | null> {
  const { url, parse } = sinaRequest(kind, symbol, unit)
  try {
    // 外盘期货 / 内盘期货日 K 返回全量历史（数百 KB），超时放宽；新浪接口需带 Referer
    const body = await requestExternal<unknown>(url, {
      timeout: kind === 'futuresInner' || kind === 'futuresGlobal' ? 20000 : 12000,
      referer: 'https://finance.sina.com.cn',
    })
    return parse(body)
  } catch (error) {
    console.warn(`[kline] 新浪 K 线失败 ${kind} ${symbol} ${unit}:`, error)
    return null
  }
}

function sinaRequest(
  kind: SinaKlineKind,
  symbol: string,
  unit: 'day' | 'week',
): { url: string; parse: (body: unknown) => KlinePoint[] | null } {
  switch (kind) {
    case 'ashare': {
      const scale = unit === 'week' ? 1680 : 240
      const url =
        `${HOSTS.sinaAshare}/quotes_service/api/json_v2.php/CN_MarketData.getKLineData` +
        `?symbol=${encodeURIComponent(symbol)}&scale=${scale}&ma=no&datalen=1023`
      return { url, parse: parseSinaAshareKline }
    }
    case 'us': {
      const url =
        `${HOSTS.sinaUs}/usstock/api/jsonp_v2.php/var%20_dshkline=/US_MinKService.getDailyK` +
        `?symbol=${encodeURIComponent(symbol)}&___qn=3`
      return { url, parse: (body) => parseSinaJsonpKline(body, SINA_US_FIELDS) }
    }
    case 'futuresInner': {
      const url =
        `${HOSTS.sinaFutures}/futures/api/jsonp.php/var%20_dshkline=/InnerFuturesNewService.getDailyKLine` +
        `?symbol=${encodeURIComponent(symbol)}`
      return { url, parse: (body) => parseSinaJsonpKline(body, SINA_INNER_FUTURES_FIELDS) }
    }
    case 'futuresGlobal': {
      const url =
        `${HOSTS.sinaFutures}/futures/api/jsonp.php/var%20_dshkline=/GlobalFuturesService.getGlobalFuturesDailyKLine` +
        `?symbol=${encodeURIComponent(symbol)}`
      return { url, parse: (body) => parseSinaJsonpKline(body, SINA_GLOBAL_FUTURES_FIELDS) }
    }
    case 'forex':
    default: {
      const url =
        `${HOSTS.sinaForex}/forex/api/jsonp.php/var%20_dshkline=/NewForexService.getDayKLine` +
        `?symbol=${encodeURIComponent(symbol)}`
      return { url, parse: parseSinaForexKline }
    }
  }
}

export const klineApi = {
  tencent: fetchTencentKline,
  sina: fetchSinaKline,
  eastmoney: fetchEastmoneyKline,
}
