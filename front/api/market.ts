import type { MarketPageData } from '../types/market'
import type { QuoteSource, SinaQuote, TencentQuote } from '../types/quote'
import {
  ASIA_INDICES,
  ASIA_JP_STOCKS,
  ASIA_KR_STOCKS,
  ASIA_RATES,
  GLOBAL_INDICES,
  INDUSTRY_BOARDS,
  MACRO_ASSETS,
  METALS,
  METAL_SECTIONS,
  metalSinaKeys,
  type AsiaIndexConfig,
  type AsiaRateConfig,
  type AsiaStockConfig,
  type MetalConfig,
} from '../config/tabbar'
import { newsApi } from './news'
import { fetchEastmoneyQuote, fetchSinaQuotes, fetchTencentQuotes } from './quote'
import { aShareSecid, bareCode } from '../utils/quote-consensus'
import { fetchAccurate, fetchAShareBoardChangeMap, fetchUsProxyChangeMap } from '../utils/quote'
import { resolveGlobalMarketSession, resolveNonferrousMarketSession } from '../utils/market-session'
import { displayName, isAbnormalPct, parseSinaQuote, validateQuote } from '../utils/quote-parser'
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
 * 由 api/quote.ts（单接口）+ utils/quote.ts（多源聚合）+ utils/market-session.ts（会话）封装。
 * 财经页（新闻）仍走后端 news 接口。
 */

// ---------------------------------------------------------------------------
// 全球页：全球指数 + 宏观经济 + 行业板块
// ---------------------------------------------------------------------------

async function getGlobalMarketPage(): Promise<MarketPageData> {
  // ① 腾讯指数（与实时会话探测共用同一次请求）
  const indexQuotes = await fetchTencentQuotes(GLOBAL_INDICES.map((item) => item.code))
  const session = await resolveGlobalMarketSession(indexQuotes)
  const indexByCode = new Map(indexQuotes.map((quote) => [quote.code, quote]))
  const indices: QuoteItem[] = GLOBAL_INDICES.map((cfg) => {
    const quote = indexByCode.get(cfg.code)
    return {
      code: cfg.code,
      name: displayName(quote?.name, cfg.name),
      price: quote?.latestPrice ?? null,
      pct: quote?.changePercent ?? null,
    }
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

  // ④ 行业板块：A股时段取东财板块涨跌幅；非 A 股时段取美股代理股涨跌幅均值
  const boardPct: Record<string, number> = {}
  if (session.useA) {
    const boardMap = await fetchAShareBoardChangeMap(INDUSTRY_BOARDS.map((board) => board.code))
    for (const board of INDUSTRY_BOARDS) {
      const pct = boardMap[board.code] ?? boardMap[`90.${board.code}`]
      if (pct !== undefined) boardPct[board.code] = pct
    }
  } else {
    const proxyMap = await fetchUsProxyChangeMap(INDUSTRY_BOARDS.flatMap((board) => board.proxies))
    for (const board of INDUSTRY_BOARDS) {
      const pcts = board.proxies
        .map((proxy) => proxyMap[proxy] ?? proxyMap[bareCode(proxy)])
        .filter((pct): pct is number => typeof pct === 'number' && Number.isFinite(pct))
      if (pcts.length) {
        boardPct[board.code] = pcts.reduce((sum, pct) => sum + pct, 0) / pcts.length
      }
    }
  }
  const sectors: QuoteItem[] = INDUSTRY_BOARDS.map((board) => ({
    code: board.code,
    name: board.name,
    price: null,
    pct: boardPct[board.code] ?? null,
  }))

  if (!indices.length && !macro.length && !sectors.length) {
    throw new Error('暂无行情数据')
  }
  return buildQuoteGlobalPage({
    indices,
    macro,
    sectors,
    statusLabel: '全球市场',
    statusTone: session.statusTone,
    sectorBadge: session.useA ? 'A股时段' : '美股时段',
  })
}

// ---------------------------------------------------------------------------
// 日韩页：指数 6 + 个股 16 + 汇率 4
// ---------------------------------------------------------------------------

async function fetchAsiaIndices(): Promise<QuoteItem[]> {
  // ① 新浪批量 1 次（6 个指数 key，等价于文档的并发 6 路）
  const rows = await fetchSinaQuotes(ASIA_INDICES.map((cfg) => cfg.sinaKey))
  const byKey = new Map(rows.map((row) => [row.key, parseSinaQuote(row.key, row.fields)]))
  const results: Array<QuoteItem | null> = new Array(ASIA_INDICES.length).fill(null)
  const fallback: AsiaIndexConfig[] = []

  ASIA_INDICES.forEach((cfg, index) => {
    const quote = byKey.get(cfg.sinaKey)
    if (quote && quote.price !== null && validateQuote(quote.price, cfg.min, cfg.max)) {
      results[index] = {
        code: cfg.code,
        name: cfg.name,

        price: quote.price,
        pct: quote.changePercent,
      }
    } else {
      fallback.push(cfg)
    }
  })

  // ③ 东财指数兜底（仅新浪解析失败时；区间校验通过才采用）
  await Promise.all(
    fallback.map(async (cfg) => {
      if (!cfg.emSecid) return
      const em = await fetchEastmoneyQuote(cfg.emSecid)
      if (em && em.latestPrice !== null && validateQuote(em.latestPrice, cfg.min, cfg.max)) {
        const index = ASIA_INDICES.indexOf(cfg)
        results[index] = {
          code: cfg.code,
          name: displayName(em.name, cfg.name),
          price: em.latestPrice,
          pct: em.changePercent,
        }
      }
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
        name: displayName(quote.name, cfg.name),
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
          name: displayName(em.name, cfg.name),
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

/** 汇率涨跌幅：|pct| < 5 归零（docs 日韩页汇率规则） */
function normalizeRatePct(pct: number | null | undefined): number | null {
  if (pct === null || pct === undefined) return null
  return Math.abs(pct) < 5 ? 0 : pct
}

/** 汇率条目（东财兜底价格 ÷100；|pct| < 5 归零） */
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
  // ① 新浪批量 1 次（4 个汇率 key）
  const rows = await fetchSinaQuotes(ASIA_RATES.map((cfg) => cfg.sinaKey))
  const byKey = new Map(rows.map((row) => [row.key, parseSinaQuote(row.key, row.fields)]))
  const results: Array<QuoteItem | null> = new Array(ASIA_RATES.length).fill(null)
  const fallback: Array<{ cfg: AsiaRateConfig; index: number }> = []

  ASIA_RATES.forEach((cfg, index) => {
    const quote = byKey.get(cfg.sinaKey)
    if (quote && quote.price !== null && quote.price > 0) {
      results[index] = rateItem(cfg, quote.price, quote.changePercent)
    } else {
      fallback.push({ cfg, index })
    }
  })

  // ② 东财汇率兜底：价格 ÷100（USDKRW 除外，直接用原值）
  await Promise.all(
    fallback.map(async ({ cfg, index }) => {
      const em = await fetchEastmoneyQuote(cfg.emSecid)
      if (em && em.latestPrice !== null) {
        const price = cfg.code === 'USDKRW' ? em.latestPrice : em.latestPrice / 100
        results[index] = rateItem(cfg, price, em.changePercent)
      } else {
        results[index] = rateItem(cfg, null, null)
      }
    }),
  )
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
    { id: 'asia-kr-index', title: '韩国指数', items: pickItems(byCode, ['KS11', 'KQ11']) },
    { id: 'asia-jp-index', title: '日本指数', items: pickItems(byCode, ['N225', 'TPX']) },
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
      { id: 'asia-kr-stock', title: '韩国个股', items: krStocks },
      { id: 'asia-jp-stock', title: '日本个股', items: jpStocks },
    ],
    rates,
    statusTone: hasLiveQuote(all) ? 'active' : 'rest',
  })
}

// ---------------------------------------------------------------------------
// 有色页：金银 / 工业金属 / 其他金属
// ---------------------------------------------------------------------------

async function resolveMetal(
  metal: MetalConfig,
  ctx: { sinaBatch: Map<string, SinaQuote>; tcMap: Map<string, TencentQuote>; useA: boolean },
): Promise<QuoteItem> {
  const base = { code: metal.code, name: metal.name }
  // ① 新浪批量：优先国内或外盘 key 列表（取决于 useA），区间校验通过即采用
  const preferred = ctx.useA ? [...metal.aKeys, ...metal.usKeys] : [...metal.usKeys, ...metal.aKeys]
  for (const key of preferred) {
    const quote = ctx.sinaBatch.get(key)
    if (!quote || quote.price === null) continue
    const range = metal.aKeys.includes(key) ? metal.aRange : metal.usRange
    if (validateQuote(quote.price, range?.[0], range?.[1])) {
      return { ...base, price: quote.price, pct: quote.changePercent }
    }
  }

  // ② 腾讯批量命中（tc 类金属股 / 钨 sh600549）
  if (metal.tc) {
    const quote = ctx.tcMap.get(metal.tc)
    if (quote && quote.valid && quote.latestPrice !== null && !isAbnormalPct(quote.changePercent)) {
      return {
        ...base,
        name: displayName(quote.name, metal.name),
        price: quote.latestPrice,
        pct: quote.changePercent,
      }
    }
  }

  // ③ 多源兜底：腾讯 → 新浪A股 → 东财（钨等再补外盘 hf_ key）
  const sources: QuoteSource[] = []
  if (metal.tc) {
    sources.push(
      { kind: 'tencent', key: metal.tc },
      { kind: 'sina_ashare', key: metal.tc.toLowerCase() },
      { kind: 'em', secid: aShareSecid(metal.tc) },
    )
  }
  if (metal.usKeys.length) {
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
      return { ...base, price: quote.price, pct: quote.changePercent }
    }
  }

  return { ...base, price: null, pct: null }
}

async function getMetalsMarketPage(): Promise<MarketPageData> {
  const session = await resolveNonferrousMarketSession()

  // ① 新浪批量 1 次（全部 nf_*/hf_* key；useA 只影响解析顺序，批量一次拉全）
  const sinaRows = await fetchSinaQuotes(metalSinaKeys())
  const sinaBatch = new Map(sinaRows.map((row) => [row.key, parseSinaQuote(row.key, row.fields)]))

  // ② 腾讯批量 1 次（tc 类金属股）
  const tcCodes = METALS.map((metal) => metal.tc).filter((code): code is string => !!code)
  const tcRows = await fetchTencentQuotes(tcCodes)
  const tcMap = new Map(tcRows.map((row) => [row.code, row]))

  // ③ 逐项解析（金银 / 工业金属 / 其他金属）
  const items = await Promise.all(
    METALS.map((metal) => resolveMetal(metal, { sinaBatch, tcMap, useA: session.useA })),
  )
  const itemByCode = new Map(METALS.map((metal, index) => [metal.code, items[index] as QuoteItem]))
  const groups: QuoteGroup[] = METAL_SECTIONS.map((section) => ({
    id: `metal-${section.id}`,
    title: section.title,
    items: section.codes.flatMap((code) => {
      const item = itemByCode.get(code)
      return item ? [item] : []
    }),
  }))

  if (!items.some((item) => item.price !== null)) {
    throw new Error('暂无行情数据')
  }
  return buildQuoteMetalsPage({
    groups,
    statusTone: session.statusTone,
    badge: session.useA ? '国内盘' : '外盘',
  })
}

// ---------------------------------------------------------------------------
// 财经页（保持后端 news 接口，不在 tabbar-api.md 范围）
// ---------------------------------------------------------------------------

async function getFinanceMarketPage(): Promise<MarketPageData> {
  const news = await newsApi.getFeed(20)
  if (!news.length) throw new Error('暂无新闻')
  const newsMetrics = news.map((item, index) => ({
    id: `finance-news-${index}`,
    name: item.title,
    value: '',
    change: 0,
    icon: '📰',
    detail: {
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
    updatedLabel: '已更新 · 财经新闻',
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
