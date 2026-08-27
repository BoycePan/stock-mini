import type { MarketPageData } from '../types/market'
import type { QuoteSource, SinaQuote, TencentQuote } from '../types/quote'
import {
  ASIA_INDICES,
  ASIA_JP_STOCKS,
  ASIA_KR_STOCKS,
  ASIA_RATES,
  AVG_PRICE_CONFIG,
  GLOBAL_INDICES,
  INDUSTRY_BOARDS,
  MACRO_ASSETS,
  METALS,
  METAL_SECTIONS,
  metalSinaKeys,
  type AsiaIndexConfig,
  type AsiaRateConfig,
  type AsiaStockConfig,
  type GlobalIndexConfig,
  type MetalConfig,
} from '../config/tabbar'
import {
  GOLD_SHOP_BRANDS,
  GOLD_SHOP_CATALOG,
  goldShopItemLabel,
  pickGoldShopItem,
} from '../config/gold-shop'
import { PHYSICAL_GOLD_CATALOG, type PhysicalGoldItemConfig } from '../config/physical-gold'
import { GOLD_SHOP_ICON_ASSETS } from '../config/icon-assets'
import { fetchGoldShopQuotes, fetchPhysicalGoldQuotes } from './gold-shop'
import { newsApi } from './news'
import {
  fetchEastmoneyAveragePrice,
  fetchEastmoneyQuote,
  fetchEastmoneyUlistQuote,
  fetchSinaQuotes,
  fetchTencentQuotes,
} from './quote'
import { aShareSecid } from '../utils/quote-consensus'
import {
  averageBoardPcts,
  fetchAccurate,
  fetchAShareAveragePrice,
  fetchAShareBoardChangeMap,
  fetchUsProxyPremarketMap,
  fetchUsProxyChangeMap,
} from '../utils/quote'
import { resolveGlobalMarketSession, resolveNonferrousMarketSession } from '../utils/market-session'
import { resolveIndustryPhase, resolveIndustrySource } from '../utils/market-clock'
import { displayName, isAbnormalPct, parseSinaQuote, validateQuote } from '../utils/quote-parser'
import { formatDateTime, formatItemUpdatedAt } from '../utils/formatter'
import {
  buildQuoteAsiaPage,
  buildQuoteGlobalPage,
  buildQuoteMetalsPage,
  hasLiveQuote,
  type QuoteGroup,
  type QuoteItem,
} from '../utils/quote-pages'

export type MarketPageKey = 'global' | 'asia' | 'metals' | 'finance'

/**
 * 行情页数据（全球 / 日韩 / 有色）全部来自 docs/tabbar-api.md 的外部接口：
 *   ① 腾讯 qt.gtimg.cn   ② 新浪 hq.sinajs.cn
 *   ③ 东财 stock/get     ④ 东财 ulist.np/get
 * 有色页额外有 ⑥ 金投网金店金价（api.jijinhao.com，见 api/gold-shop.ts）。
 * 由 api/quote.ts（单接口）+ utils/quote.ts（多源聚合）+ utils/market-session.ts（会话）封装。
 * 财经页（新闻）仍走后端 news 接口。
 */

// ---------------------------------------------------------------------------
// 全球页：A股指数 + 美股指数 + 宏观经济 + 行业板块
// ---------------------------------------------------------------------------

/**
 * A股平均股价取数链（通达信 880003 口径，全市场等权平均）：
 * ①东财官方平均股价指数（ulist.np/get，secid 47.800005，用户指定接口，见 api/quote.ts）
 * → ②腾讯 sh880003（与全球指数同批请求，零额外请求）→ ③新浪 sh880003 →
 * ④东财全市场等权自算（60s 缓存，见 utils/quote.ts）。
 * 任一路给出有效价格即采用；全部失败返回 null（卡片显示 --）。
 */
async function resolveAShareAveragePrice(
  indexQuotes: TencentQuote[],
): Promise<{ price: number | null; pct: number | null }> {
  const em = await fetchEastmoneyAveragePrice(AVG_PRICE_CONFIG.emSecid)
  if (em && em.price !== null && em.price > 0 && !isAbnormalPct(em.changePercent)) {
    return { price: em.price, pct: em.changePercent }
  }
  const tc = indexQuotes.find((quote) => quote.code === AVG_PRICE_CONFIG.tc)
  if (tc?.valid && tc.latestPrice !== null && !isAbnormalPct(tc.changePercent)) {
    return { price: tc.latestPrice, pct: tc.changePercent }
  }
  const sinaRows = await fetchSinaQuotes([AVG_PRICE_CONFIG.sinaKey])
  const sina = parseSinaQuote(AVG_PRICE_CONFIG.sinaKey, sinaRows[0]?.fields ?? [])
  if (sina.price !== null && sina.price > 0 && !isAbnormalPct(sina.changePercent)) {
    return { price: sina.price, pct: sina.changePercent }
  }
  console.warn('[global] 东财平均股价指数/腾讯/新浪 均无有效数据，回退东财全市场等权自算')
  return fetchAShareAveragePrice()
}

async function getGlobalMarketPage(): Promise<MarketPageData> {
  // ① 腾讯指数（与实时会话探测共用同一次请求；顺带批量拉 880003 平均股价）
  const indexQuotes = await fetchTencentQuotes([
    ...GLOBAL_INDICES.map((item) => item.code),
    AVG_PRICE_CONFIG.tc,
  ])
  const session = await resolveGlobalMarketSession(indexQuotes)
  const indexByCode = new Map(indexQuotes.map((quote) => [quote.code, quote]))
  const indexItem = (cfg: GlobalIndexConfig): QuoteItem => {
    const quote = indexByCode.get(cfg.code)
    return {
      code: cfg.code,
      name: displayName(quote?.name, cfg.name),
      price: quote?.latestPrice ?? null,
      pct: quote?.changePercent ?? null,
    }
  }
  // 全球指数按市场归属拆分展示：A股指数（A股四大指数）+ 美股指数（三大指数）
  const cnIndices = GLOBAL_INDICES.filter((cfg) => cfg.market === 'cn').map(indexItem)
  const usIndices = GLOBAL_INDICES.filter((cfg) => cfg.market === 'us').map(indexItem)
  // 美股指数区末尾的入口卡：点击进入「美股市值TOP100」列表（纯前端直连东财 clist/get，
  // 见 docs/us-top100-api.md；入口跳转在 utils/market-page-factory.ts onMetricTap 拦截）
  usIndices.push({
    code: 'us-top100',
    name: '市值TOP100',
    price: null,
    pct: null,
    valueText: '查看',
    hideChange: true,
    hideFromPoster: true,
  })
  // A股平均股价插在A股指数末尾（属于 A 股口径，不放入美股指数）；
  // 分时源与卡片报价同 secid（47.800005，东财官方平均股价指数，见 config/minute.ts AVG）
  const avgPrice = await resolveAShareAveragePrice(indexQuotes)
  cnIndices.push({
    code: AVG_PRICE_CONFIG.code,
    name: AVG_PRICE_CONFIG.name,
    price: avgPrice.price,
    pct: avgPrice.pct,
  })

  // ② 新浪批量预取宏观资产全部 key（供 fetchAccurate 复用，避免重复请求）
  const sinaKeys = Array.from(
    new Set(
      MACRO_ASSETS.flatMap((asset) =>
        asset.sources.flatMap((source) =>
          source.kind.startsWith('sina') && source.key
            ? Array.isArray(source.key)
              ? source.key
              : [source.key]
            : [],
        ),
      ),
    ),
  )
  const sinaRows = await fetchSinaQuotes(sinaKeys)
  const sinaBatch = new Map(sinaRows.map((row) => [row.key, parseSinaQuote(row.key, row.fields)]))

  // ③ 宏观资产逐项 fetchAccurate（新浪批量优先，腾讯 / 东财兜底，共识取中位数）
  const macro: QuoteItem[] = []
  for (const asset of MACRO_ASSETS) {
    const quote = await fetchAccurate(asset.sources, { sina: sinaBatch }, { parallel: 2 })
    macro.push({
      code: asset.code,
      name: asset.name,
      price: quote?.price ?? null,
      pct: quote?.changePercent ?? null,
    })
  }

  // ④ 行业板块：数据源随市场时段三态切换（utils/market-clock.ts resolveIndustrySource）：
  //    - 'a'（A股时段 09:15–15:00 含午休 + 待盘前窗口 15:00–盘前开始前）→ 东财 A 股板块涨跌幅；
  //    - 'us-pre'（美股盘前 美东 04:00–09:30，夏令时/冬令时对应北京 16:00–21:30 / 17:00–22:30）
  //      → 新浪 gb_ 盘前参考涨跌幅（us-sector-premarket.js 口径，仅参考涨跌幅、无分时图）；
  //    - 'us'（美股盘中/盘后、周末）→ 美股代理股涨跌幅均值（既有逻辑）。
  const industrySource = resolveIndustrySource(session)
  const boardPct: Record<string, number> = {}
  if (industrySource === 'a') {
    const boardMap = await fetchAShareBoardChangeMap(INDUSTRY_BOARDS.map((board) => board.code))
    for (const board of INDUSTRY_BOARDS) {
      const pct = boardMap[board.code] ?? boardMap[`90.${board.code}`]
      if (pct !== undefined) boardPct[board.code] = pct
    }
  } else {
    const proxyMap =
      industrySource === 'us-pre'
        ? await fetchUsProxyPremarketMap(INDUSTRY_BOARDS.flatMap((board) => board.proxies))
        : await fetchUsProxyChangeMap(INDUSTRY_BOARDS.flatMap((board) => board.proxies))
    for (const board of INDUSTRY_BOARDS) {
      const avg = averageBoardPcts(board.proxies, proxyMap)
      if (avg !== null) boardPct[board.code] = avg
    }
  }
  const sectors: QuoteItem[] = INDUSTRY_BOARDS.map((board) => {
    const item: QuoteItem = {
      code: board.code,
      name: board.name,
      price: null,
      pct: boardPct[board.code] ?? null,
    }
    if (industrySource === 'us') {
      // 美股时段：卡片展示的是美股代理股涨跌幅均值，分时同样取代理股均值合成（us-BKxxxx，
      // 见 config/minute.ts 的 emProxies），口径一致；不再指向 A 股板块（90.BKxxxx）分时。
      item.minuteCode = `us-${board.code}`
    } else if (industrySource === 'us-pre') {
      // 盘前仅支持查看参考涨跌幅、不支持分时图：minuteCode 置为无源占位（MINUTE_SOURCES 无
      // 此 key → hasMinuteSources=false），点击卡片 toast 提示（见 market-page-factory onMetricTap
      // 的 minuteUnavailableTip 分支），绝不跳转分时页。
      item.minuteCode = `us-pre-${board.code}`
      item.minuteUnavailableTip = '盘前仅支持查看参考涨跌幅，暂不支持分时图'
    }
    return item
  })

  if (!cnIndices.length && !usIndices.length && !macro.length && !sectors.length) {
    throw new Error('暂无行情数据')
  }
  return buildQuoteGlobalPage({
    cnIndices,
    usIndices,
    macro,
    sectors,
    statusLabel: '全球市场',
    statusTone: session.statusTone,
    sectorTitle: industrySource === 'a' ? '中国行业板块' : '美股行业板块',
    // 阶段化胶囊与数据源一致：A股板块 → 大A盘中/午间休市/集合竞价/休市（含待盘前窗口）；
    // 美股盘前 → 「美股盘前」（quiet 蓝）；美股代理 → 美股盘中/盘后/休市
    sectorPhase: resolveIndustryPhase(session, new Date(), industrySource),
    // 盘前仅支持参考涨跌幅：不展示「分时」角标（美股代理与 A 股板块照常）
    sectorMinuteCorner: industrySource !== 'us-pre',
  })
}

// ---------------------------------------------------------------------------
// 日韩页：指数 6 + 个股 16 + 汇率 5
// ---------------------------------------------------------------------------

async function fetchAsiaIndices(): Promise<QuoteItem[]> {
  // ① 新浪批量 1 次（6 个指数 key，等价于文档的并发 6 路）
  const rows = await fetchSinaQuotes(ASIA_INDICES.map((cfg) => cfg.sinaKey))
  const byKey = new Map(rows.map((row) => [row.key, parseSinaQuote(row.key, row.fields)]))
  const results: Array<QuoteItem | null> = new Array(ASIA_INDICES.length).fill(null)

  // 新浪源条目（区间校验通过才采用）
  const sinaItem = (cfg: AsiaIndexConfig): QuoteItem | null => {
    const quote = byKey.get(cfg.sinaKey)
    if (quote && quote.price !== null && validateQuote(quote.price, cfg.min, cfg.max)) {
      return { code: cfg.code, name: cfg.name, price: quote.price, pct: quote.changePercent }
    }
    return null
  }
  // 东财源条目（仅配置了 emSecid 时可用；区间校验通过才采用）
  const emItem = async (cfg: AsiaIndexConfig): Promise<QuoteItem | null> => {
    if (!cfg.emSecid) return null
    const em = await fetchEastmoneyQuote(cfg.emSecid)
    if (em && em.latestPrice !== null && validateQuote(em.latestPrice, cfg.min, cfg.max)) {
      return {
        code: cfg.code,
        name: displayName(em.name, cfg.name),
        price: em.latestPrice,
        pct: em.changePercent,
      }
    }
    return null
  }

  // 默认 新浪优先、东财失败兜底；preferEm 的标的（新浪源陈旧/不更新，如 int_nikkei）东财优先、
  // 东财失败退回新浪。东财 secid 与分时页同源（100.N225 / 100.VNINDEX），
  // 保证「卡片展示值」与「点进去的分时」口径一致。
  await Promise.all(
    ASIA_INDICES.map(async (cfg, index) => {
      results[index] =
        cfg.preferEm && cfg.emSecid
          ? ((await emItem(cfg)) ?? sinaItem(cfg))
          : (sinaItem(cfg) ?? (await emItem(cfg)))
    }),
  )
  return results.filter((item): item is QuoteItem => item !== null)
}

async function fetchAsiaStocks(configs: AsiaStockConfig[]): Promise<QuoteItem[]> {
  if (!configs.length) return []
  // ① 腾讯批量 1 次（全部个股，命中则不拉东财）
  const rows = await fetchTencentQuotes(configs.map((cfg) => cfg.tc))
  const byTc = new Map(rows.map((row) => [row.code, row]))
  const results: Array<QuoteItem | null> = new Array(configs.length).fill(null)
  const fallback: Array<{ cfg: AsiaStockConfig; index: number }> = []

  configs.forEach((cfg, index) => {
    const quote = byTc.get(cfg.tc)
    if (quote && quote.valid && quote.latestPrice !== null && !isAbnormalPct(quote.changePercent)) {
      results[index] = {
        code: cfg.code,
        // 韩/日个股固定展示配置的中文名（腾讯等源返回英文名，如 Samsung Electronics Co., Ltd.）
        name: cfg.name,
        price: quote.latestPrice,
        pct: quote.changePercent,
      }
    } else {
      fallback.push({ cfg, index })
    }
  })

  // ② 东财个股兜底（并发补齐未命中项）
  await Promise.all(
    fallback.map(async ({ cfg, index }) => {
      const em = await fetchEastmoneyQuote(cfg.emSecid)
      if (em && em.latestPrice !== null) {
        results[index] = {
          code: cfg.code,
          // 同上：东财兜底也统一用配置的中文名
          name: cfg.name,
          price: em.latestPrice,
          pct: em.changePercent,
        }
      } else {
        results[index] = { code: cfg.code, name: cfg.name, price: null, pct: null }
      }
    }),
  )
  return results.filter((item): item is QuoteItem => item !== null)
}

/**
 * 汇率涨跌幅：仅丢弃异常值（|pct| >= 80，与 fetchAccurate 同款护栏）。
 * 外汇日间波动通常 <1%（实测 -0.3% ~ +0.05%），正常小波动原样保留，
 * 不再做「|pct|<5 归零」（旧规则会把所有真实涨跌压成 0）。
 */
function normalizeRatePct(pct: number | null | undefined): number | null {
  if (pct === null || pct === undefined) return null
  return isAbnormalPct(pct) ? null : pct
}

/** 汇率条目（东财兜底价格 ÷100；涨跌幅仅做异常护栏） */
function rateItem(
  cfg: AsiaRateConfig,
  price: number | null,
  pct: number | null | undefined,
): QuoteItem {
  return {
    code: cfg.code,
    name: cfg.name,

    price,
    pct: normalizeRatePct(pct),
  }
}

async function fetchAsiaRates(): Promise<QuoteItem[]> {
  // ① 新浪批量 1 次（5 个汇率 key）
  const rows = await fetchSinaQuotes(ASIA_RATES.map((cfg) => cfg.sinaKey))
  const byKey = new Map(rows.map((row) => [row.key, parseSinaQuote(row.key, row.fields)]))
  // ② 逐项解析：默认 新浪优先、东财兜底（价格 ÷100）；preferEm 的汇率（如 USDCNY）东财
  //    ulist 优先（fltt=2 十进制，与分时页同 secid，见 config/minute.ts USDCNY），东财失败退回新浪。
  const resolveOne = async (cfg: AsiaRateConfig): Promise<QuoteItem> => {
    const sina = byKey.get(cfg.sinaKey)
    const sinaItem =
      sina && sina.price !== null && sina.price > 0
        ? rateItem(cfg, sina.price, sina.changePercent)
        : null
    if (cfg.preferEm && cfg.emSecid) {
      const em = await fetchEastmoneyUlistQuote(cfg.emSecid)
      if (em && em.price !== null && em.price > 0) {
        return rateItem(cfg, em.price, em.changePercent)
      }
      return sinaItem ?? rateItem(cfg, null, null)
    }
    if (sinaItem) return sinaItem
    // 东财汇率兜底：价格 ÷100（119 汇率 f43 为 10^4 倍精度，
    //    normalizeEastmoneyQuote 按 f152=2 已 ÷100，这里需再 ÷100；USDKRW 同样适用）
    const em = await fetchEastmoneyQuote(cfg.emSecid)
    if (em && em.latestPrice !== null && em.latestPrice > 0) {
      return rateItem(cfg, em.latestPrice / 100, em.changePercent)
    }
    return rateItem(cfg, null, null)
  }
  const results = await Promise.all(ASIA_RATES.map((cfg) => resolveOne(cfg)))
  return results.filter((item): item is QuoteItem => item !== null)
}

function pickItems(byCode: Map<string, QuoteItem>, codes: string[]): QuoteItem[] {
  return codes
    .map((code) => byCode.get(code))
    .filter((item): item is QuoteItem => item !== undefined)
}

async function getAsiaMarketPage(): Promise<MarketPageData> {
  const allIndexItems = await fetchAsiaIndices()
  const byCode = new Map(allIndexItems.map((item) => [item.code, item]))
  const indexGroups: QuoteGroup[] = [
    {
      id: 'asia-kr-index',
      title: '韩国指数',
      items: pickItems(byCode, ['KS11', 'KQ11']),
      region: 'kr',
    },
    {
      id: 'asia-jp-index',
      title: '日本指数',
      items: pickItems(byCode, ['N225', 'TPX']),
      region: 'jp',
    },
    { id: 'asia-asia-index', title: '亚洲指数', items: pickItems(byCode, ['VNINDEX', 'SENSEX']) },
  ]

  const krStocks = await fetchAsiaStocks(ASIA_KR_STOCKS)
  const jpStocks = await fetchAsiaStocks(ASIA_JP_STOCKS)
  const rates = await fetchAsiaRates()

  const all = [...allIndexItems, ...krStocks, ...jpStocks, ...rates]
  if (!all.length) throw new Error('暂无行情数据')

  return buildQuoteAsiaPage({
    indexGroups,
    stockGroups: [
      { id: 'asia-kr-stock', title: '韩国核心个股', items: krStocks, region: 'kr' },
      { id: 'asia-jp-stock', title: '日本核心个股', items: jpStocks, region: 'jp' },
    ],
    rates,
    statusTone: hasLiveQuote(all) ? 'active' : 'rest',
  })
}

// ---------------------------------------------------------------------------
// 有色页：金银 / 工业金属 / 其他金属
// ---------------------------------------------------------------------------

/** 多源兜底命中的来源是否属于 A 股个股（腾讯 / 新浪A股 / 东财个股接口） */
const A_SHARE_SOURCES = new Set(['tencent', 'sina_ashare', 'em'])

/**
 * 金属分时取数随会话切换，保证「卡片展示什么，点进去就看到什么」：
 * - 国内盘（useA）：卡片展示沪主连/A股个股，分时沿用 config/minute.ts 既有源（113.xm / shxxxxxx）；
 * - 外盘（useA=false）：GOLD/SILVER/COPPER 卡片展示 COMEX 报价，分时切到已验证的 COMEX 源
 *   （GOLD-US/SILVER-US/COPPER-US）；铝/锌/镍/锡/钨卡片展示外盘报价但无已验证外盘分时源，
 *   用 us- 前缀占位（无源）并给提示，避免误入沪主连/A股分时；钼/锗/铟/锑无外盘报价，
 *   外盘时段仍展示 A 股个股，分时不变。
 */
function metalMinuteVariant(
  metal: MetalConfig,
  useA: boolean,
): Pick<QuoteItem, 'minuteCode' | 'minuteUnavailableTip'> | undefined {
  if (useA) return undefined
  switch (metal.code) {
    case 'GOLD':
      return { minuteCode: 'GOLD-US' }
    case 'SILVER':
      return { minuteCode: 'SILVER-US' }
    case 'COPPER':
      return { minuteCode: 'COPPER-US' }
    default:
      return metal.usKeys.length
        ? {
            minuteCode: `us-${metal.code}`,
            minuteUnavailableTip:
              '外盘时段该金属展示外盘报价，暂无对应外盘分时图；国内盘时段可查看',
          }
        : undefined
  }
}

async function resolveMetal(
  metal: MetalConfig,
  ctx: {
    sinaBatch: Map<string, SinaQuote>
    tcMap: Map<string, TencentQuote>
    useA: boolean
    /**
     * 强制只取内盘(a)或外盘(us)口径（黄金内外盘同屏展示时使用）：
     * 缺省按 useA 会话二选一；restrict='a' 只走 aKeys（国内），
     * restrict='us' 只走 emSecid/usKeys（外盘），杜绝内外盘价格单位串口径。
     */
    restrict?: 'a' | 'us'
  },
): Promise<QuoteItem> {
  const base = { code: metal.code, name: metal.name }
  // 分时取数随会话切换（外盘时段切 COMEX / 占位无源，见 metalMinuteVariant）
  const minute = metalMinuteVariant(metal, ctx.useA)
  // ①b 外盘优先东财（金银 emSecid 与首页宏观卡片、分时页同源）：
  //     新浪 hf_GC/hf_SI 的 [0] 最新价系统性偏高（实测黄金 4664.48 vs 东财 4661.60、
  //     白银 69.725 vs 69.01），不再作外盘首选；东财失败时仍走下方新浪批量兜底。
  //     取数走 fetchEastmoneyUlistQuote（ulist + fltt=2 十进制）：市场 101 的 stock/get
  //     原始刻度无规则（GC×10 / SI×1000），10^f152 除数会得到错误价格被区间校验丢弃。
  //     仅外盘口径（restrict='us' 或未 restrict 且外盘会话）尝试东财。
  if (metal.emSecid && (ctx.restrict === 'us' || (ctx.restrict === undefined && !ctx.useA))) {
    const emQuote = await fetchEastmoneyUlistQuote(metal.emSecid)
    if (
      emQuote &&
      emQuote.price !== null &&
      validateQuote(emQuote.price, metal.usRange?.[0], metal.usRange?.[1])
    ) {
      return { ...base, ...minute, price: emQuote.price, pct: emQuote.changePercent }
    }
  }
  // ① 新浪批量：优先国内或外盘 key 列表（取决于 useA / restrict），区间校验通过即采用
  const preferred = [
    ...(ctx.useA ? metal.aKeys : metal.usKeys),
    ...(ctx.useA ? metal.usKeys : metal.aKeys),
  ].filter((key) => {
    if (ctx.restrict === 'a') return metal.aKeys.includes(key)
    if (ctx.restrict === 'us') return metal.usKeys.includes(key)
    return true
  })
  for (const key of preferred) {
    const quote = ctx.sinaBatch.get(key)
    if (!quote || quote.price === null) continue
    const range = metal.aKeys.includes(key) ? metal.aRange : metal.usRange
    if (validateQuote(quote.price, range?.[0], range?.[1])) {
      return { ...base, ...minute, price: quote.price, pct: quote.changePercent }
    }
  }

  // ② 腾讯批量命中（tc 类金属股 / 钨 sh600549）：展示的是个股股价，打「个股」标；
  //    外盘口径（restrict='us'）不使用 A股个股源
  if (metal.tc && ctx.restrict !== 'us') {
    const quote = ctx.tcMap.get(metal.tc)
    if (quote && quote.valid && quote.latestPrice !== null && !isAbnormalPct(quote.changePercent)) {
      return {
        ...base,
        ...minute,
        name: displayName(quote.name, metal.name),
        price: quote.latestPrice,
        pct: quote.changePercent,
        // 展示的是个股股价：标「个股」+ 所代表的金属
        tags: ['个股', metal.name],
      }
    }
  }

  // ③ 多源兜底：腾讯 → 新浪A股 → 东财（钨等再补外盘 hf_ key）
  const sources: QuoteSource[] = []
  if (metal.tc && ctx.restrict !== 'us') {
    sources.push(
      { kind: 'tencent', key: metal.tc },
      { kind: 'sina_ashare', key: metal.tc.toLowerCase() },
      { kind: 'em', secid: aShareSecid(metal.tc) },
    )
  }
  if (metal.usKeys.length && ctx.restrict !== 'a') {
    sources.push({
      kind: 'sina_hf',
      key: metal.usKeys,
      min: metal.usRange?.[0],
      max: metal.usRange?.[1],
    })
  }
  if (sources.length) {
    const quote = await fetchAccurate(sources, {}, { parallel: 2 })
    if (quote && quote.price !== null) {
      return {
        ...base,
        ...minute,
        price: quote.price,
        pct: quote.changePercent,
        // 命中个股来源（如钼/锗/铟/锑的 tc 兜底）时标「个股」+ 代表金属；外盘 hf_ 等金属报价不加标
        tags: A_SHARE_SOURCES.has(quote.source) ? ['个股', metal.name] : undefined,
      }
    }
  }

  return { ...base, ...minute, price: null, pct: null }
}

async function getMetalsMarketPage(): Promise<MarketPageData> {
  // 金店金价 / 实物黄金价格与行情拉取并行；失败返回 null（页面跳过对应分区，不影响整页）
  const goldShopPromise = fetchGoldShopGroup()
  const physicalGoldPromise = fetchPhysicalGoldGroup()
  const session = await resolveNonferrousMarketSession()

  // ① 新浪批量 1 次（全部 nf_*/hf_* key；useA 只影响解析顺序，批量一次拉全）
  const sinaRows = await fetchSinaQuotes(metalSinaKeys())
  const sinaBatch = new Map(sinaRows.map((row) => [row.key, parseSinaQuote(row.key, row.fields)]))

  // ② 腾讯批量 1 次（tc 类金属股）
  const tcCodes = METALS.map((metal) => metal.tc).filter((code): code is string => !!code)
  const tcRows = await fetchTencentQuotes(tcCodes)
  const tcMap = new Map(tcRows.map((row) => [row.code, row]))

  // ③ 金银内外盘同屏：黄金、白银恒同时解析内盘（沪金主连 元/克 / 沪银主连 元/千克）与外盘
  //    （COMEX 美元/盎司）两路报价，不再随交易时段二选一（restrict 强制各自口径，见 resolveMetal）；
  //    其余金属仍随会话切换。
  const goldCfg = METALS.find((metal) => metal.code === 'GOLD')!
  const silverCfg = METALS.find((metal) => metal.code === 'SILVER')!
  const [[goldCn, goldUs], [silverCn, silverUs]] = await Promise.all([
    Promise.all([
      resolveMetal(goldCfg, { sinaBatch, tcMap, useA: true, restrict: 'a' }),
      resolveMetal(goldCfg, { sinaBatch, tcMap, useA: false, restrict: 'us' }),
    ]),
    Promise.all([
      resolveMetal(silverCfg, { sinaBatch, tcMap, useA: true, restrict: 'a' }),
      resolveMetal(silverCfg, { sinaBatch, tcMap, useA: false, restrict: 'us' }),
    ]),
  ])
  const dualCards: Record<string, QuoteItem[]> = {
    GOLD: [
      { ...goldCn, name: '黄金·内盘', tags: ['元/克'] },
      { ...goldUs, name: '黄金·外盘', tags: ['美元/盎司'] },
    ],
    SILVER: [
      { ...silverCn, name: '白银·内盘', tags: ['元/千克'] },
      { ...silverUs, name: '白银·外盘', tags: ['美元/盎司'] },
    ],
  }

  // ④ 其余金属逐项解析（工业金属 / 其他金属，随会话切换）
  const otherMetals = METALS.filter((metal) => metal.code !== 'GOLD' && metal.code !== 'SILVER')
  const items = await Promise.all(
    otherMetals.map((metal) => resolveMetal(metal, { sinaBatch, tcMap, useA: session.useA })),
  )
  const itemByCode = new Map(
    otherMetals.map((metal, index) => [metal.code, items[index] as QuoteItem]),
  )
  const groups: QuoteGroup[] = METAL_SECTIONS.map((section) => ({
    id: `metal-${section.id}`,
    title: section.title,
    tip: section.tip,
    items: section.codes.flatMap((code) => {
      // 金银卡替换为 内盘+外盘 双卡；其余金属按原逻辑取一张卡
      const dual = dualCards[code]
      if (dual) return dual
      const item = itemByCode.get(code)
      return item ? [item] : []
    }),
  }))

  // ④ 实物黄金价格分区（上海黄金交易所现货基准价，优先于金店金价）
  const physicalGoldGroup = await physicalGoldPromise
  if (physicalGoldGroup && physicalGoldGroup.items.length) {
    groups.push(physicalGoldGroup)
  }

  // ⑤ 金店金价分区（真实金店零售价，独立外部源，失败自动隐藏）
  const goldShopGroup = await goldShopPromise
  if (goldShopGroup && goldShopGroup.items.length) {
    groups.push(goldShopGroup)
  }

  if (
    ![...items, goldCn, goldUs, silverCn, silverUs].some((item) => item.price !== null) &&
    !goldShopGroup?.items.length &&
    !physicalGoldGroup?.items.length
  ) {
    throw new Error('暂无行情数据')
  }
  return buildQuoteMetalsPage({
    groups,
    statusTone: session.statusTone,
  })
}

/**
 * 拉取金店金价并组装为分区（每品牌一行，展示足金/零售口径）。
 * 任何失败都返回 null，由调用方决定是否展示，绝不让该分区拖垮整页。
 */
async function fetchGoldShopGroup(): Promise<QuoteGroup | null> {
  try {
    const quotes = await fetchGoldShopQuotes()
    if (!quotes.length) return null
    const byCode = new Map(quotes.map((quote) => [quote.code, quote]))
    const items: QuoteItem[] = []
    for (const shop of GOLD_SHOP_BRANDS) {
      const configs = GOLD_SHOP_CATALOG[shop] ?? []
      if (!configs.length) continue
      const chosen = pickGoldShopItem(configs, byCode)
      if (!chosen) continue
      // 标签用目录品类名（如「零售价」→「零售」），不用上游 showName（可能是一长串）
      const config = configs.find((item) => item.code === chosen.code)
      items.push({
        code: `GS-${shop}`,
        name: shop,
        price: chosen.price,
        pct: chosen.pct,
        icon: '🏬',
        // 品牌 logo（icons/brand/<品牌名>.png；官网不可达的品牌为占位图）
        iconImage: GOLD_SHOP_ICON_ASSETS[shop],
        tags: [goldShopItemLabel(config?.item ?? chosen.item)],
        // 上游每条报价带 time（epoch ms），展示为「HH:mm 更新」（跨天补日期）
        updatedAt: formatItemUpdatedAt(chosen.time),
      })
    }
    if (!items.length) return null
    return {
      id: 'metal-gold-shop',
      title: '金店金价',
      tip: '金店足金饰品零售价（元/克），来源：网络公开数据，仅供参考，以门店实际挂牌价为准',
      items,
      // 上游不保证提供涨跌幅（常为 0），为 0 时隐藏涨跌徽标，避免展示无意义的 0.00%
      hideFlatChange: true,
    }
  } catch (error) {
    console.warn('[metals] 金店金价分区构建失败，跳过:', error)
    return null
  }
}

/**
 * 拉取上海黄金交易所实物黄金价格并组装为分区（黄金9999 为基准价）。
 * 失败或全部无价时返回 null，由调用方决定是否展示。
 */
async function fetchPhysicalGoldGroup(): Promise<QuoteGroup | null> {
  try {
    const quotes = await fetchPhysicalGoldQuotes()
    if (!quotes.length) return null
    const byCode = new Map(quotes.map((quote) => [quote.code, quote]))
    const items: QuoteItem[] = []
    for (const cfg of PHYSICAL_GOLD_CATALOG) {
      const quote = byCode.get(cfg.code)
      // 区间校验防上游异常快照（如金条50g 无报价返回 0）
      if (!quote || !validateQuote(quote.price, cfg.min, cfg.max)) continue
      items.push(physicalGoldItemOf(cfg, quote))
    }
    if (!items.length) return null
    return {
      id: 'metal-physical-gold',
      title: '实物黄金价格',
      tip: '上海黄金交易所现货价格：黄金/铂金为元/克，白银为元/千克；来源：网络公开数据，仅供参考',
      items,
      // 部分品种（如金条100g）上游涨跌幅为 0，为 0 时隐藏涨跌徽标
      hideFlatChange: true,
    }
  } catch (error) {
    console.warn('[metals] 实物黄金价格分区构建失败，跳过:', error)
    return null
  }
}

/** 单个 SGE 品种 → 展示条目；单位非「元/克」时（白银 元/千克）加单位标签防误解 */
function physicalGoldItemOf(
  cfg: PhysicalGoldItemConfig,
  quote: { price: number; pct: number },
): QuoteItem {
  return {
    code: `SGE-${cfg.code}`,
    name: cfg.name,
    price: quote.price,
    pct: quote.pct,
    icon: '🏛️',
    tags: cfg.unit && cfg.unit !== '元/克' ? [cfg.unit] : undefined,
  }
}

// ---------------------------------------------------------------------------
// 财经页（保持后端 news 接口，不在 tabbar-api.md 范围）
// ---------------------------------------------------------------------------

async function getFinanceMarketPage(): Promise<MarketPageData> {
  // 财经资讯每页固定拉取 10 条（页面列表展示条数）
  // 新闻接口需要登录鉴权：走请求层登录门闩并携带 Authorization，不再提供跳过登录的公开路径
  const news = await newsApi.getFeed(1, 10)
  if (!news.length) throw new Error('暂无新闻')
  const newsMetrics = news.map((item, index) => ({
    id: `finance-news-${index}`,
    name: item.title,
    value: '',
    change: 0,
    icon: '📰',
    detail: {
      // 保留后端真实 id（如 77415）：财经页滚动加载时作为游标传给 /news/feed（第一页第一条 id）
      id: item.id ? String(item.id) : undefined,
      title: item.title,
      summary: item.summary ?? '',
      url: item.url,
      source: item.source ?? '',
      time: item.time ?? '',
    },
  }))
  return {
    statusLabel: '财经',
    statusTone: 'active',
    updatedLabel: `数据更新时间：${formatDateTime()}`,
    sections: [{ id: 'finance-news', title: '财经新闻', tone: 'finance', metrics: newsMetrics }],
  }
}

export const marketApi = {
  async getPage(key: MarketPageKey): Promise<MarketPageData> {
    switch (key) {
      case 'global':
        return getGlobalMarketPage()
      case 'asia':
        return getAsiaMarketPage()
      case 'metals':
        return getMetalsMarketPage()
      case 'finance':
        return getFinanceMarketPage()
    }
  },
}
