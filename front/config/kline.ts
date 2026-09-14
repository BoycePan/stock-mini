/**
 * 分时页「日/周/月/年 K」数据源映射（纯前端直连国内公开行情，见 docs/minute-api.md）。
 *
 * 为什么不用东财：东财历史 K 线只有 push2his / 82.push2his 节点提供，延迟节点 push2delay
 * 明确返回空 klines（`{"data":{"klines":[]}}`），而 push2his 在小程序客户端被反爬拦截
 * （实测连接重置，见 docs/魔方板块分析/魔方板块-接口文档.md）。因此 K 线走：
 *   1. 腾讯 web.ifzq.gtimg.cn（已在合法域名白名单内，与腾讯分时同域）
 *      覆盖 A股 / A股指数 / 港股 / 日股 / 韩股 / 美股个股 / 美股指数 / 外汇（wh）；
 *   2. 新浪（期货、外盘期货、外汇、A股与美股备用）
 *      覆盖内盘期货主连（沪金/沪银/沪铜…）、外盘期货（COMEX 金/银/铜、NYMEX 天然气、布伦特原油）、
 *      美元指数与外汇日 K、A股/美股备用。
 *
 * 年 K 无任何国内直连源：统一由月 K（否则周 K、日 K）聚合，见 utils/kline.ts aggregateKlines。
 * 因此「有 K 线源」等价于「日/周/月/年四个 TAB 都有数据可画」。
 *
 * 无 K 线源的标的（不登记 → TAB 置灰并给出提示，分时不受影响）：
 *   - 东财板块指数（BKxxxx）与美股代理合成板块（us-BKxxxx）：板块历史 K 线仅东财 push2his 提供；
 *   - A股平均股价 AVG（东财自编指数 47.800005）：腾讯/新浪无对应标的；
 *   - 日韩与越南/印度指数（KS11 / N225 / VNINDEX / SENSEX）：腾讯只覆盖个股与美股指数；
 *   - 费城半导体指数 SOX；交叉汇率合成标的（CNYKRW / CNYJPY）。
 */

import { ashareTcCode, EM_US_SECID_RE, MINUTE_SOURCES } from './minute'
import type { SinaKlineKind } from '../api/kline'

export interface KlineSources {
  /**
   * 腾讯 K 线代码候选（按序尝试，命中一个即固定使用）：
   * 美股后缀（.OQ 纳斯达克 / .N 纽交所 / .A 美交所）在腾讯侧与东财市场号并非一一对应
   * （实测东财 107 的美交所 ETF 在腾讯是 .N），所以按候选顺序探测而非硬映射。
   */
  tc?: string[]
  /** 新浪 K 线（端点族 + 代码 + 支持的周期，缺省只支持日线） */
  sina?: { kind: SinaKlineKind; symbol: string; week?: boolean }
  /** K 线口径提示（如「现货用期货日线代理」），展示在分时页图表标题下方 */
  note?: string
}

/**
 * 需要显式登记的标的（个股走下方正则兜底，不必逐条登记）。
 * key 与 config/minute.ts 的 MINUTE_SOURCES 保持同一套卡片 code。
 */
export const KLINE_SOURCES: Record<string, KlineSources> = {
  // -------------------------------------------------------------------------
  // 全球页 · A股指数 / 美股指数
  // -------------------------------------------------------------------------
  sh000001: { tc: ['sh000001'], sina: { kind: 'ashare', symbol: 'sh000001', week: true } },
  sz399001: { tc: ['sz399001'], sina: { kind: 'ashare', symbol: 'sz399001', week: true } },
  sz399006: { tc: ['sz399006'], sina: { kind: 'ashare', symbol: 'sz399006', week: true } },
  sh000688: { tc: ['sh000688'], sina: { kind: 'ashare', symbol: 'sh000688', week: true } },
  // AVG（东财平均股价指数）：无国内直连 K 线源 → 不登记
  usDJI: { tc: ['usDJI'], sina: { kind: 'us', symbol: '.DJI' } }, // 道琼斯工业
  usINX: { tc: ['usINX'], sina: { kind: 'us', symbol: '.INX' } }, // 标普500
  usIXIC: { tc: ['usIXIC'], sina: { kind: 'us', symbol: '.IXIC' } }, // 纳斯达克综合

  // -------------------------------------------------------------------------
  // 全球页 · 宏观经济
  // -------------------------------------------------------------------------
  BRT: {
    sina: { kind: 'futuresGlobal', symbol: 'OIL' },
    note: 'K线为布伦特原油连续合约（新浪外盘 OIL）',
  },
  UDI: { tc: ['whDINIW', 'usUDI'], sina: { kind: 'forex', symbol: 'DINIW' } }, // 美元指数
  TLT: { tc: ['usTLT.N', 'usTLT.OQ', 'usTLT.A'] }, // 美债长债 ETF
  GC: {
    sina: { kind: 'futuresGlobal', symbol: 'GC' },
    note: 'K线为 COMEX 黄金期货连续（新浪外盘 GC），与卡片现货口径略有价差',
  },
  SI: {
    sina: { kind: 'futuresGlobal', symbol: 'SI' },
    note: 'K线为 COMEX 白银期货连续（新浪外盘 SI），与卡片现货口径略有价差',
  },
  HG: {
    sina: { kind: 'futuresGlobal', symbol: 'HG' },
    note: 'K线为 COMEX 铜期货连续（新浪外盘 HG）',
  },
  NG: {
    sina: { kind: 'futuresGlobal', symbol: 'NG' },
    note: 'K线为 NYMEX 天然气期货连续（新浪外盘 NG）',
  },
  // SOX（费城半导体指数）：腾讯 usSOX 无数据 → 不登记

  // -------------------------------------------------------------------------
  // 日韩页 · 汇率（腾讯 wh 外汇覆盖 CNY/JPY/美元指数；KRW 仅新浪有）
  // -------------------------------------------------------------------------
  USDKRW: { sina: { kind: 'forex', symbol: 'USDKRW' } },
  USDJPY: { tc: ['whUSDJPY'], sina: { kind: 'forex', symbol: 'USDJPY' } },
  USDCNY: {
    sina: { kind: 'forex', symbol: 'USDCNH' },
    note: 'K线取美元/离岸人民币（新浪 USDCNH），与卡片离岸口径一致',
  },
  // CNYKRW / CNYJPY：交叉汇率合成标的，无直连 K 线源 → 不登记

  // -------------------------------------------------------------------------
  // 有色页 · 沪期货主连（新浪内盘期货日 K）
  // -------------------------------------------------------------------------
  GOLD: {
    sina: { kind: 'futuresInner', symbol: 'AU0' },
    note: 'K线为沪金主连（新浪内盘 AU0）日线',
  },
  SILVER: {
    sina: { kind: 'futuresInner', symbol: 'AG0' },
    note: 'K线为沪银主连（新浪内盘 AG0）日线',
  },
  COPPER: {
    sina: { kind: 'futuresInner', symbol: 'CU0' },
    note: 'K线为沪铜主连（新浪内盘 CU0）日线',
  },
  ALUMINUM: {
    sina: { kind: 'futuresInner', symbol: 'AL0' },
    note: 'K线为沪铝主连（新浪内盘 AL0）日线',
  },
  ZINC: {
    sina: { kind: 'futuresInner', symbol: 'ZN0' },
    note: 'K线为沪锌主连（新浪内盘 ZN0）日线',
  },
  NICKEL: {
    sina: { kind: 'futuresInner', symbol: 'NI0' },
    note: 'K线为沪镍主连（新浪内盘 NI0）日线',
  },
  TIN: {
    sina: { kind: 'futuresInner', symbol: 'SN0' },
    note: 'K线为沪锡主连（新浪内盘 SN0）日线',
  },

  // -------------------------------------------------------------------------
  // 有色页 · 外盘时段（金银用 COMEX 连续合约代理，铜同源）
  // -------------------------------------------------------------------------
  'GOLD-US': {
    sina: { kind: 'futuresGlobal', symbol: 'GC' },
    note: '外盘时段 K线为 COMEX 黄金期货连续（新浪外盘 GC），与卡片现货口径略有价差',
  },
  'SILVER-US': {
    sina: { kind: 'futuresGlobal', symbol: 'SI' },
    note: '外盘时段 K线为 COMEX 白银期货连续（新浪外盘 SI），与卡片现货口径略有价差',
  },
  'COPPER-US': {
    sina: { kind: 'futuresGlobal', symbol: 'HG' },
    note: '外盘时段 K线为 COMEX 铜期货连续（新浪外盘 HG）',
  },
}

/** 美股市场后缀候选（腾讯侧按序探测：纳斯达克 / 纽交所 / 美交所） */
const US_SUFFIXES = ['.OQ', '.N', '.A'] as const

/**
 * 取某标的的 K 线源（无源返回 null）。
 * 除显式登记外，以下形态走正则兜底，保证个股无需逐条登记：
 * - A股个股：`sh600519` / `sz000001` / `bj920010`（腾讯代码）或 `1.600519` / `0.000001`（东财 secid）；
 * - 美股个股：东财 secid `105.NVDA` / `106.BRK_B` / `107.BATT`（见 config/minute.ts EM_US_SECID_RE）；
 * - 韩股 / 日股个股：6 位裸代码，按 MINUTE_SOURCES 里的东财市场号（177=韩 / 176=日）判定腾讯前缀。
 */
export function resolveKlineSources(code: string): KlineSources | null {
  if (!code) return null
  // 查表用自有属性判定（code 可能来自 URL query，避免命中 Object.prototype 上的方法）
  if (Object.prototype.hasOwnProperty.call(KLINE_SOURCES, code)) {
    return KLINE_SOURCES[code] ?? null
  }
  // 美股代理合成板块（us-BKxxxx）：板块历史 K 线无直连源
  if (/^us-/i.test(code)) return null
  // A股个股 / A股指数：腾讯代码直接可用
  if (/^(sh|sz|bj)\d{6}$/.test(code)) {
    return { tc: [code], sina: { kind: 'ashare', symbol: code, week: true } }
  }
  // 东财 A股 secid（1.600519 / 0.000001）
  if (/^[01]\.\d{6}$/.test(code)) {
    const tc = ashareTcCode(code.slice(2))
    return { tc: [tc], sina: { kind: 'ashare', symbol: tc, week: true } }
  }
  // 美股个股/ADR（东财 secid → 腾讯 us<TICKER>.<后缀>，后缀按序探测）
  if (EM_US_SECID_RE.test(code)) {
    const ticker = code.split('.')[1] ?? ''
    if (!ticker) return null
    return {
      tc: US_SUFFIXES.map((suffix) => `us${ticker.toUpperCase()}${suffix}`),
      sina: { kind: 'us', symbol: ticker.toUpperCase() },
    }
  }
  // 韩股 / 日股个股（裸代码：韩股 6 位、日股 4 位；市场号取自分时配置的东财 secid）
  if (/^\d{4,6}$/.test(code)) {
    const em = Object.prototype.hasOwnProperty.call(MINUTE_SOURCES, code)
      ? (MINUTE_SOURCES[code]?.em ?? '')
      : ''
    if (em.startsWith('177.')) return { tc: [`kr${code}`] }
    if (em.startsWith('176.')) return { tc: [`jp${code}`] }
    return null
  }
  // 卡片别名指向 A股个股（如钨/钼/锗/铟/锑 → 厦门钨业等，见 config/minute.ts）：
  // 按分时配置里的东财 secid 还原成 A股个股源，避免为别名逐条登记
  const alias = Object.prototype.hasOwnProperty.call(MINUTE_SOURCES, code)
    ? (MINUTE_SOURCES[code]?.em ?? '')
    : ''
  if (/^[01]\.\d{6}$/.test(alias)) {
    const tc = ashareTcCode(alias.slice(2))
    return { tc: [tc], sina: { kind: 'ashare', symbol: tc, week: true } }
  }
  return null
}

/** 该标的是否有 K 线数据源（日/周/月/年四个 TAB 是否可用） */
export function hasKlineSources(code: string): boolean {
  return !!resolveKlineSources(code)
}
