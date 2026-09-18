/**
 * 分时页「日/周/月/年 K」数据源映射（纯前端直连国内公开行情，见 docs/minute-api.md）。
 *
 * 为什么不用东财：东财历史 K 线只有 push2his / 82.push2his 节点提供，延迟节点 push2delay
 * 明确返回空 klines（`{"data":{"klines":[]}}`），而 push2his 在小程序客户端被反爬拦截
 * （实测连接重置，见 docs/魔方板块分析/魔方板块-接口文档.md）。因此 K 线走：
 *   1. 腾讯 web.ifzq.gtimg.cn（已在合法域名白名单内，与腾讯分时同域）
 *      覆盖 A股 / A股指数 / 港股 / 美股个股 / 美股指数 / 外汇（wh）；
 *      日股 / 韩股**不覆盖**：`kr005930` / `jp7203` 的 day/week/month 实测都只回当日 1 根
 *      （低于 MIN_KLINE_BARS=2，恒判无效）→ 日韩个股改走东财 176./177. 分时同 secid；
 *   2. 新浪（期货、外盘期货、外汇、A股与美股备用）
 *      覆盖内盘期货主连（沪金/沪银/沪铜…）、外盘期货（COMEX 金/银/铜、NYMEX 天然气、布伦特原油）、
 *      美元指数与外汇日 K、A股/美股备用。
 *
 * 年 K 无任何国内直连源：统一由月 K（否则周 K、日 K）聚合，见 utils/kline.ts aggregateKlines。
 * 因此「有 K 线源」等价于「日/周/月/年四个 TAB 都有数据可画」。
 *
 * 东财历史 K 线（push2his，klt=101/102/103）覆盖腾讯与新浪都没有的标的：
 *   - A股板块指数（东财 90.BKxxxx，与首页「行业板块」卡片同源同口径）；
 *   - 国际指数（100.KS11 / 100.N225 / 100.VNINDEX / 100.SENSEX）、费城半导体（251.SOX）；
 *   - A股平均股价（东财自编指数 47.800005）；
 *   - **日韩个股（177=韩 / 176=日，与分时同一 secid）**：腾讯无可用日 K，只能走东财；
 *   - 美股时段板块（us-BKxxxx）由代理股日线归一化均值合成，与卡片 / 分时同口径；
 *   - 交叉汇率（CNYKRW / CNYJPY）由两腿日线逐日相除合成（新浪外汇）。
 *   注意：push2his 对异常出口 IP / 高频请求会空响应或直接拒连（见 docs/行情页多周期图表.md
 *   「上线注意事项」），故除上述标的外不登记东财源，避免可靠源标的白等一次往返。
 *
 * 无 K 线源的标的（不登记 → TAB 置灰并给出提示，分时不受影响）：
 *   目前仅剩「分时本身也没有源」的标的（KOSDAQ / TOPIX / VIX 等，本就不在 MINUTE_SOURCES 中）。
 *   覆盖度由 tests/kline-source.test.ts 强制校验。
 */

import { ashareTcCode, EM_US_SECID_RE, MINUTE_SOURCES } from './minute'
import { INDUSTRY_BOARDS } from './tabbar'
import type { SinaKlineKind } from '../api/kline'

export interface KlineSources {
  /**
   * 腾讯 K 线代码候选（按序尝试，命中一个即固定使用）：
   * 美股后缀按**东财市场号映射**（105 纳指 → `.OQ` / 106 纽交所 → `.N` / 107 美交所 → `.N`）
   * 之后再挂其余后缀兜底，见 US_SUFFIX_ORDER 的实测说明。
   */
  tc?: string[]
  /**
   * 源优先级（缺省 `em → tc → sina`）：
   * 仅用于「东财 secid 历史过短、但另有更长历史的兜底源」的标的——费城半导体 `SOX` 的东财
   * `251.SOX` 是 2026 年新上的口径（仅 53 根日线 / 3 根月线），年 K 根本聚合不出来，
   * 因此把新浪 `.SOX`（2014 年起 3185 根）提到前面，见 docs/行情页多周期图表.md。
   */
  sourceOrder?: Array<'em' | 'tc' | 'sina'>
  /** 新浪 K 线（端点族 + 代码 + 支持的周期，缺省只支持日线） */
  sina?: { kind: SinaKlineKind; symbol: string; week?: boolean }
  /**
   * 东财 K 线 secid（腾讯 / 新浪都没有可用日线的标的）：
   * - A股板块指数 `90.BKxxxx`、国际指数 `100.KS11` 等、A股平均股价 `47.800005`；
   * - **日韩个股 `177.xxxxxx` / `176.xxxx`**（腾讯 fqkline 只回当日 1 根，见文件头说明）。
   * 其余标的只要腾讯或新浪有可用日线就不登记此项——东财 push2his 对异常流量会空响应 /
   * 拒连，不应让可靠源标的每次白等一次往返（见 api/kline.ts 头部说明）。
   */
  em?: string
  /**
   * 美股代理股日线均值合成（美股时段板块 us-BKxxxx）：东财美股 secid 数组，
   * 与卡片、分时的口径一致（各代理按基准日归一化到 100 后逐日取均值）。
   * 每只代理的日线取数走它自己的既有兜底链（腾讯 `us<TICKER>.OQ/.N/.A` → 新浪美股）。
   */
  proxies?: string[]
  /**
   * 比值合成（交叉汇率等）：两腿各取日线后逐日相除（分子 ÷ 分母）。
   * 仅支持日线（周 / 月 / 年由日线聚合），两腿都取日线。
   */
  cross?: { numerator: KlineSources; denominator: KlineSources }
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
  // AVG（东财平均股价指数 47.800005）：腾讯 / 新浪均无对应标的 → 只走东财 K 线
  AVG: { em: '47.800005', note: 'K线为东方财富A股平均股价指数（与卡片同源）' },
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
  // SOX（费城半导体指数）：东财 251.SOX 是 2026 年新口径（仅 53 根日线 / 3 根月线，年 K 聚合不出来），
  // 故把新浪美股 .SOX（2014-01-16 起 3185 根日线）提到主源；东财保留为兜底。
  SOX: {
    sina: { kind: 'us', symbol: '.SOX' },
    em: '251.SOX',
    sourceOrder: ['sina', 'em'],
  },

  // -------------------------------------------------------------------------
  // 日韩页 · 指数（腾讯 krKOSPI / jpN225 均 param error → 只有东财覆盖）
  // -------------------------------------------------------------------------
  KS11: { em: '100.KS11' }, // 韩国 KOSPI
  N225: {
    em: '100.N225',
    // 日经225 现货：东财 100.N225；兜底用新浪外盘 CME 日经225 期货连续（点位与现货接近，
    // 实测同一时点基差 ~0.2%），故只在东财不可用时才展示，并给出期货口径提示
    sina: { kind: 'futuresGlobal', symbol: 'NK' },
    note: 'K线优先取日经225现货（东财）；期货连续合同时与现货点位略有基差',
  },
  VNINDEX: { em: '100.VNINDEX' }, // 越南胡志明
  SENSEX: { em: '100.SENSEX' }, // 印度孟买 SENSEX

  // -------------------------------------------------------------------------
  // 日韩页 · 汇率（腾讯 wh 外汇覆盖 CNY/JPY/美元指数；KRW 仅新浪有）
  // -------------------------------------------------------------------------
  USDKRW: { sina: { kind: 'forex', symbol: 'USDKRW' } },
  USDJPY: { tc: ['whUSDJPY'], sina: { kind: 'forex', symbol: 'USDJPY' } },
  USDCNY: {
    sina: { kind: 'forex', symbol: 'USDCNH' },
    note: 'K线取美元/离岸人民币（新浪 USDCNH），与卡片离岸口径一致',
  },
  // CNYKRW / CNYJPY：东财无直盘日线，按两腿日线逐日相除合成（新浪外汇，与分时的合成口径一致）
  CNYKRW: {
    cross: {
      numerator: { sina: { kind: 'forex', symbol: 'USDKRW' } },
      denominator: { sina: { kind: 'forex', symbol: 'USDCNH' } },
    },
    note: 'K线为「美元/韩元 ÷ 美元/离岸人民币」两腿日线合成（离岸口径，与分时同思路）',
  },
  CNYJPY: {
    cross: {
      numerator: { sina: { kind: 'forex', symbol: 'USDJPY' } },
      denominator: { sina: { kind: 'forex', symbol: 'USDCNH' } },
    },
    note: 'K线为「美元/日元 ÷ 美元/离岸人民币」两腿日线合成（离岸口径，与卡片在岸口径略有价差）',
  },

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

  // -------------------------------------------------------------------------
  // 行业板块 · A股时段（东财板块指数 90.BKxxxx）与美股时段（代理股日线均值合成）
  // 由 config/tabbar.ts 的 INDUSTRY_BOARDS 单一数据源生成，保证卡片 / 分时 / K 线同口径。
  // -------------------------------------------------------------------------
  ...buildIndustryBoardKlineSources(),
}

/** 行业板块的 K 线源：A股时段登记东财板块指数，美股时段登记代理股合成 */
function buildIndustryBoardKlineSources(): Record<string, KlineSources> {
  const entries: Record<string, KlineSources> = {}
  for (const board of INDUSTRY_BOARDS) {
    // A股时段：东财板块指数（与卡片报价、分时同一 secid 90.BKxxxx，无口径差异）
    entries[board.code] = { em: `90.${board.code}` }
    // 美股时段：与卡片一致的代理股日线均值合成（基准=100）
    entries[`us-${board.code}`] = { proxies: [...board.proxies] }
  }
  return entries
}

/**
 * 美股腾讯后缀候选顺序（按东财市场号映射）：
 * - 105 纳斯达克 → `.OQ` 优先；
 * - 106 纽交所 → `.N` 优先。**必须 `.N` 在前**：腾讯对错误后缀并不总是只回 1 根（会被
 *   MIN_KLINE_BARS 拦掉），部分标的会回「最早 500 根 + 最新 1 根」的补丁式序列（根数够、但近一年
 *   只有 1 根），命中后就会被固定使用，导致 CPO/证券/消费电子三个美股板块的代理腿公共交易日
 *   交集塌缩成 1 天、整板 K 线全空（详见 docs/tabbar卡片分时与K线取数核查.md §4.1）；
 * - 107 美交所及部分 ETF → 实测在腾讯是 `.N`，故 `.N` 优先，`.A` 次之。
 */
const US_SUFFIX_ORDER: Record<string, readonly string[]> = {
  '105': ['.OQ', '.N', '.A'],
  '106': ['.N', '.OQ', '.A'],
  '107': ['.N', '.A', '.OQ'],
}

/**
 * 东财美股 ticker → 腾讯 / 新浪代码片段。
 * 东财把类别股写成 `BRK_A`，腾讯与新浪都用 `BRK.A`（腾讯侧再拼交易所后缀，即 `usBRK.A.N`）。
 */
function usTickerSymbol(ticker: string): string {
  return ticker.replace(/_/g, '.').toUpperCase()
}

/**
 * 取某标的的 K 线源（无源返回 null）。
 * 除显式登记外，以下形态走正则兜底，保证个股无需逐条登记：
 * - A股个股：`sh600519` / `sz000001` / `bj920010`（腾讯代码）或 `1.600519` / `0.000001`（东财 secid）；
 * - 美股个股：东财 secid `105.NVDA` / `106.BRK_B` / `107.BATT`（见 config/minute.ts EM_US_SECID_RE）；
 * - 韩股 / 日股个股：6 位裸代码，主源取 MINUTE_SOURCES 里的东财 secid（177=韩 / 176=日），
 *   腾讯 `kr` / `jp` 前缀代码仅作兜底探测（实测其 day/week/month 只回当日 1 根，不能当主源）；
 * - A股板块指数：分时配置里 secid 为 `90.BKxxxx` 的标的（新增板块不必两处登记）。
 */
export function resolveKlineSources(code: string): KlineSources | null {
  if (!code) return null
  // 查表用自有属性判定（code 可能来自 URL query，避免命中 Object.prototype 上的方法）
  if (Object.prototype.hasOwnProperty.call(KLINE_SOURCES, code)) {
    return KLINE_SOURCES[code] ?? null
  }
  // 美股代理合成板块（us-BKxxxx）：未登记的板块无直连源（已登记的走上面的查表，见
  // buildIndustryBoardKlineSources 的代理股合成）
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
  // 美股个股/ADR（东财 secid → 腾讯 us<TICKER>.<后缀>，后缀按东财市场号映射后逐个探测）
  if (EM_US_SECID_RE.test(code)) {
    const raw = code.split('.')[1] ?? ''
    if (!raw) return null
    const ticker = usTickerSymbol(raw)
    const suffixes = US_SUFFIX_ORDER[code.split('.')[0] ?? ''] ?? ['.OQ', '.N', '.A']
    return {
      tc: suffixes.map((suffix) => `us${ticker}${suffix}`),
      sina: { kind: 'us', symbol: ticker },
    }
  }
  // 韩股 / 日股个股（裸代码：韩股 6 位、日股 4 位；东财市场号取自分时配置的 secid）
  // **东财优先**：腾讯 fqkline 对日韩个股的 day/week/month 实测都只回「当日 1 根」
  // （kr005930 / jp7203 三种周期均为 1 行，见 docs/行情页多周期图表.md 复验记录），
  // 低于 MIN_KLINE_BARS=2 恒被判无效，故腾讯只能作为兜底探测、不能当主源（否则四个 TAB 永远空态）。
  if (/^\d{4,6}$/.test(code)) {
    const em = Object.prototype.hasOwnProperty.call(MINUTE_SOURCES, code)
      ? (MINUTE_SOURCES[code]?.em ?? '')
      : ''
    if (em.startsWith('177.')) return { em, tc: [`kr${code}`] }
    if (em.startsWith('176.')) return { em, tc: [`jp${code}`] }
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
  // A股板块指数（分时配置里 secid 为 90.BKxxxx）：东财板块指数日线（与卡片同源）
  if (/^90\.BK\d+$/i.test(alias)) return { em: alias }
  return null
}

/** 该标的是否有 K 线数据源（日/周/月/年四个 TAB 是否可用） */
export function hasKlineSources(code: string): boolean {
  return !!resolveKlineSources(code)
}
