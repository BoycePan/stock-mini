import { fetchAllBoards, fetchBoardMembers, type BoardKind } from '../../../api/industry-boards'
import { fetchUsBoardMembers, fetchUsBoardRows } from '../../../api/us-board-quotes'
import type { UsBoardKind } from '../../../config/us-board-catalog'
import {
  filterIndustryRows,
  sortIndustryRows,
  type IndustryBoardRow,
  type PctSortDir,
} from '../../../utils/industry-boards'
import { filterUsBoardRows, type UsBoardRow, type UsMemberRow } from '../../../utils/us-boards'
import { ashareTcCode } from '../../../config/minute'
import { rootStore } from '../../../stores/root.store'
import { startAutoRefresh, stopAutoRefresh } from '../../../utils/auto-refresh'
import { computeChangeView } from '../../../utils/market'
import { buildSharePath, SHARE_IMAGE_URL } from '../../../utils/share'
import {
  APP_NAME,
  formatShareStamp,
  type PosterData,
  type PosterRow,
  type PosterSection,
  type PosterTone,
} from '../../../utils/share-poster'
import { bindTheme, unbindTheme } from '../../../utils/theme'
import { trackEvent } from '../../../utils/tracker'

/**
 * 板块列表页 —— A股全部板块（概念板块 + 行业板块）+ 美股精选板块（概念 + 行业）。
 *
 * A 股（纯前端直连东财 clist/get，分页拉全量板块清单）：
 * - 概念板块：fs=m:90+t:3+f:!50（约 504 项，华为 / 机器人 / 低空经济 等主题）；
 * - 行业板块：fs=m:90+t:2+f:!50（496 项，石油石化 / 煤炭 / 钢铁 等一级~三级细分）。
 *
 * 美股（国内公开源无「美股板块全量目录行情」接口，采用首页同口径的精选目录 +
 * 美股成分股实时聚合，见 config/us-board-catalog.ts / api/us-board-quotes.ts）：
 * - 美股概念：精选主题 43 项（AI算力 / 减肥药 / 加密货币 / 量子计算 等）；
 * - 美股行业：精选行业 40 项（银行 / 保险 / 半导体设备 / 医疗 等）；
 * - 板块涨跌幅 = 成分股（东财 secid，新浪 gb_ 优先、东财 ulist 兜底）当日涨跌幅等权均值，
 *   美股盘前时段（resolveIndustrySource==='us-pre'）展示新浪 gb_ 盘前参考涨跌幅；
 * - 成分弹窗 = 该板块美股成分股实时涨跌幅（中文名来自东财 f14），点击进当日分时图
 *   （minute 页按 EM_US_SECID_RE 直接识别 105./106./107. secid）。
 *
 * 四类均支持按名称/代码过滤 + 按涨跌幅排序，仅展示涨跌幅（板块无价格）。
 * 分享能力与其他页面一致「经首页中转」：顶栏「分享」按当前 tab 生成分享海报
 * （标题为当前分类，主体为领涨 / 领跌板块双榜各 8 名），右上角胶囊的系统默认分享
 * 与分享原图的「打开小程序」入口均经 utils/share.ts buildSharePath 带回当前 tab
 * （见 refreshPosterData / switchTab 的 shareEntrancePath / onShareAppMessage）。
 * 默认 tab 为 A股概念；从首页板块入口进入时按首页板块展示口径透传 ?tab= 预选默认 tab
 * （首页展示 A股板块 → 概念板块；美股 → 美股概念，见 onLoad / utils/market-page-factory.ts）。
 * 全量 A 股清单量小（合计约千行）与美股目录（83 项）均按板块分类缓存在模块级：
 * 切 tab / 二次进入直接复用缓存渲染，并后台静默刷新保鲜，避免反复整页 loading。
 */

/** 列表自动刷新间隔：60s（全量约千行，刷新节奏比 100 行列表放慢，避免频繁重渲染） */
const LIST_REFRESH_INTERVAL = 60000
/** 分享海报每个榜单收录的板块数（双列网格 4 行 × 2 列，避免海报过长） */
const POSTER_BOARD_LIMIT = 8
/** 模块级共享（跨页面实例）：onShow 立即刷新门闩，距上次请求不足 5s 不补刷 */
let lastListRequestAt = 0
/** 成分股弹窗加载串行队列（跨页面实例共享）：关闭后重开其它板块时排队等待，
 *  避免在途旧请求把上一板块的成分股写进新标题下。 */
let memberChain: Promise<void> = Promise.resolve()

/** 页面内板块大类：A股概念 / A股行业 + 美股概念 / 美股行业 */
type TabKind = BoardKind | 'us-concept' | 'us-industry'

/** 是否美股板块 Tab（取数/过滤/成分弹窗走美股聚合口径） */
function isUsKind(kind: TabKind): boolean {
  return kind === 'us-concept' || kind === 'us-industry'
}

/** 美股 Tab 键 → 精选目录分类（us-concept → concept / us-industry → industry） */
function usCatalogKind(kind: TabKind): UsBoardKind {
  return kind === 'us-concept' ? 'concept' : 'industry'
}

/**
 * tab 顺序：A股概念在前（默认展示），A股行业、美股概念、美股行业在后；
 * 从首页板块入口进入时可透传 ?tab=（如 concept / us-concept）预选默认 tab（见 onLoad）。
 */
const TAB_ORDER: TabKind[] = ['concept', 'industry', 'us-concept', 'us-industry']

/** 单个板块分类的展示元信息（标题 / 文案随 tab 切换） */
interface BoardKindMeta {
  /** tab 标签 */
  label: string
  /** 导航标题 */
  headerTitle: string
  /** 搜索框占位 */
  searchPlaceholder: string
  /** 「共 N 个{{countUnit}}」的计数单位 */
  countUnit: string
  /** 全屏 loading 文案 */
  loadingText: string
  loadingDesc: string
  /** 列表上方数据来源说明（A股板块 = 板块公开行情；美股板块 = 成分股等权聚合口径） */
  dataNote: string
  /** 加载失败错误文案 */
  errorText: string
  /** 无匹配结果文案 */
  emptyText: string
}

const KIND_META: Record<TabKind, BoardKindMeta> = {
  concept: {
    label: '概念板块',
    headerTitle: 'A股概念板块',
    searchPlaceholder: '搜索概念，如 CPO / 机器人 / 华为',
    countUnit: '概念',
    loadingText: '正在加载全部概念板块',
    loadingDesc: '正在为您同步 A 股全部概念板块涨跌幅，请稍候…',
    dataNote: '行情来自公开接口，仅供参考，不构成投资建议。',
    errorText: '概念板块加载失败，请点击下方按钮重试',
    emptyText: '未找到匹配的概念，换个关键词试试',
  },
  industry: {
    label: '行业板块',
    headerTitle: 'A股行业板块',
    searchPlaceholder: '搜索行业，如 煤炭 / 证券',
    countUnit: '行业',
    loadingText: '正在加载全部行业',
    loadingDesc: '正在为您同步 A 股全部行业板块涨跌幅，请稍候…',
    dataNote: '行情来自公开接口，仅供参考，不构成投资建议。',
    errorText: '行业板块加载失败，请点击下方按钮重试',
    emptyText: '未找到匹配的行业，换个关键词试试',
  },
  'us-concept': {
    label: '美股概念',
    headerTitle: '美股概念板块',
    searchPlaceholder: '搜索概念或代码，如 减肥药 / NVDA',
    countUnit: '板块',
    loadingText: '正在加载美股概念板块',
    loadingDesc: '正在同步美股概念板块涨跌幅（成分股行情聚合，可能有延迟），请稍候…',
    dataNote:
      '美股板块涨跌幅为成分股行情等权聚合（公开行情，可能有延迟），仅供参考，不构成投资建议。',
    errorText: '美股概念板块加载失败，请点击下方按钮重试',
    emptyText: '未找到匹配的概念，换个关键词试试',
  },
  'us-industry': {
    label: '美股行业',
    headerTitle: '美股行业板块',
    searchPlaceholder: '搜索行业或代码，如 银行 / TSLA',
    countUnit: '板块',
    loadingText: '正在加载美股行业板块',
    loadingDesc: '正在同步美股行业板块涨跌幅（成分股行情聚合，可能有延迟），请稍候…',
    dataNote:
      '美股板块涨跌幅为成分股行情等权聚合（公开行情，可能有延迟），仅供参考，不构成投资建议。',
    errorText: '美股行业板块加载失败，请点击下方按钮重试',
    emptyText: '未找到匹配的行业，换个关键词试试',
  },
}

/** 每个板块分类的模块级清单缓存（跨页面实例共享：量小，切 tab 即时展示） */
interface BoardKindCache {
  /** 已拉取的原始条目（未排序 / 未过滤；美股行运行时携带 proxies 字段） */
  rawItems: IndustryBoardRow[]
  /** 是否已有成功数据（供复用缓存渲染；成功且非空才置 true） */
  loaded: boolean
  /** 最近一次成功拉取时间戳（0 = 尚未成功） */
  lastSuccessAt: number
}

function createKindCache(): BoardKindCache {
  return { rawItems: [], loaded: false, lastSuccessAt: 0 }
}

/** 模块级缓存（同一小程序会话内跨页面实例共享） */
const cacheByKind: Record<TabKind, BoardKindCache> = {
  concept: createKindCache(),
  industry: createKindCache(),
  'us-concept': createKindCache(),
  'us-industry': createKindCache(),
}

/** 列表行展示模型（涨跌幅文本 + 着色；板块行 / 成分股行共用） */
interface IndustryRowView extends IndustryBoardRow {
  pctText: string
  pctClass: 'up' | 'down' | 'flat'
  /** 美股板块行：成分股 secid 列表（成分弹窗按此取数） */
  proxies?: string[]
  /** 美股板块行：成分个数文案（如「成分 5 只」）；A股行缺省展示 code */
  codeText?: string
  /** 美股成分股行：成分股东财 secid（跳分时用），A股成分行缺省 */
  mcode?: string
}

function toView(item: IndustryBoardRow): IndustryRowView {
  const pct = computeChangeView(item.pct)
  return {
    ...item,
    pctText: pct.changeText,
    pctClass: pct.changeClass,
  }
}

/** 美股板块行视图：额外携带成分个数文案与成分 secid */
function toUsBoardView(item: UsBoardRow): IndustryRowView {
  return {
    ...toView(item),
    proxies: item.proxies,
    codeText: `成分 ${item.proxies.length} 只`,
  }
}

/** 美股成分股行 → 通用行模型（code=ticker 展示，mcode=secid 保留给跳分时） */
type MemberRow = IndustryBoardRow & { mcode?: string }

function toMemberRows(rows: UsMemberRow[]): MemberRow[] {
  return rows.map((row) => ({ code: row.code, name: row.name, pct: row.pct, mcode: row.mcode }))
}

/** 「HH:MM 更新」标签 */
function buildUpdatedLabel(time: number): string {
  const d = new Date(time)
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return `${hh}:${mm} 更新`
}

Page({
  data: {
    theme: rootStore.settings.theme,
    /** tab 列表（A股概念在前，A股行业、美股概念、美股行业在后） */
    tabs: TAB_ORDER.map((key) => ({ key, label: KIND_META[key].label })),
    /** 当前 tab：默认 A股概念板块（首页入口按展示口径透传 ?tab= 覆盖，见 onLoad） */
    activeTab: 'concept' as TabKind,
    /* ---- 当前 tab 的展示文案（随切 tab 同步，供 wxml 使用） ---- */
    headerTitle: KIND_META.concept.headerTitle,
    searchPlaceholder: KIND_META.concept.searchPlaceholder,
    countUnit: KIND_META.concept.countUnit,
    loadingText: KIND_META.concept.loadingText,
    loadingDesc: KIND_META.concept.loadingDesc,
    dataNote: KIND_META.concept.dataNote,
    emptyText: KIND_META.concept.emptyText,
    loading: true,
    error: '',
    /** 当前展示条目（当前 tab：过滤 + 排序后的视图） */
    items: [] as IndustryRowView[],
    /** 名称/代码过滤词（四类板块共用，切 tab 保留） */
    query: '',
    /** 涨跌幅排序方向：默认领涨在前 */
    sortDir: 'desc' as PctSortDir,
    /** 当前 tab 板块总数（过滤前），头部展示 */
    totalCount: 0,
    updatedLabel: '',
    /** 分享海报数据（当前 tab 的领涨 / 领跌双榜，随 tab / 数据刷新同步，见 refreshPosterData） */
    posterData: null as PosterData | null,
    /**
     * 分享原图（wx.showShareImageMenu）的小程序入口路径：与分享图一致带当前 tab，
     * 接收方从图上的「打开小程序」进入时经首页中转回到本页同一分类（utils/share.ts buildSharePath）。
     */
    shareEntrancePath: '',
    /** 各板块分类是否有请求进行中（不入渲染，供 isLoading / 防并发使用） */
    requestingByKind: {
      concept: false,
      industry: false,
      'us-concept': false,
      'us-industry': false,
    } as Record<TabKind, boolean>,
    /** scroll-view 下拉刷新进行中（refresher-triggered 受控值） */
    refreshing: false,
    /* ---- 板块成分股弹窗 ---- */
    memberVisible: false,
    memberLoading: false,
    memberError: '',
    /** 成分股为空（成功但 0 只） */
    memberEmpty: false,
    memberBoardName: '',
    memberBoardCode: '',
    /** 板块所属 tab 标签（概念板块 / 行业板块 / 美股概念 / 美股行业） */
    memberKindLabel: '',
    /** 成分股只数（过滤前） */
    memberCount: 0,
    memberSortDir: 'desc' as PctSortDir,
    memberUpdatedLabel: '',
    /** 成分股原始条目（未排序，供切换领涨/领跌时重排） */
    memberRawRows: [] as MemberRow[],
    /** 成分股当前展示条目（排序后） */
    memberItems: [] as IndustryRowView[],
  },

  isLoading() {
    return this.data.requestingByKind[this.data.activeTab]
  },

  /** 页面是否仍为当前展示页（页面栈最后一项）：轮询触发前据此校验 */
  isCurrentPage(): boolean {
    const pages = getCurrentPages()
    const current = pages[pages.length - 1] as WechatMiniprogram.Page.TrivialInstance | undefined
    return current === (this as unknown as WechatMiniprogram.Page.TrivialInstance)
  },

  onLoad(options: Record<string, string | undefined> = {}) {
    bindTheme(this)
    // 从首页板块区入口进入时按首页当前展示口径预选默认 tab（入口透传 URL ?tab=，
    // 见 utils/market-page-factory.ts industry-all 拦截 / api/market.ts 入口构建：
    // 首页展示 A股板块 → 概念板块；美股 → 美股概念），保证默认选中与首页展示状态一致；
    // 直接进入或非法取值回退 A股概念板块。加载策略与手动切 tab 一致（switchTab）。
    this.switchTab(this.resolveInitialTab(options.tab))
  },

  onShow() {
    startAutoRefresh(this, lastListRequestAt, LIST_REFRESH_INTERVAL)
  },

  onHide() {
    stopAutoRefresh(this)
  },

  /**
   * scroll-view 下拉刷新（页面级下拉已关闭，见 index.json enablePullDownRefresh=false）：
   * 静默刷新当前 tab 数据——不闪整页 loading，列表原地保留，下拉圈显示到请求结束；
   * 已有请求进行中（自动刷新 tick / 手动）时直接结束，避免并发。
   */
  onRefresherRefresh() {
    if (this.isLoading()) {
      this.setData({ refreshing: false })
      return
    }
    this.setData({ refreshing: true })
    void this.loadData({ silent: true }).finally(() => {
      this.setData({ refreshing: false })
    })
  },

  /** 重算当前 tab 展示列表（内存过滤 + 排序，不重新请求） */
  refreshView() {
    const cache = cacheByKind[this.data.activeTab]
    const { query, sortDir } = this.data
    const rows = isUsKind(this.data.activeTab)
      ? sortIndustryRows(filterUsBoardRows(cache.rawItems as UsBoardRow[], query), sortDir)
      : sortIndustryRows(filterIndustryRows(cache.rawItems, query), sortDir)
    this.setData({
      items: isUsKind(this.data.activeTab)
        ? rows.map((row) => toUsBoardView(row as UsBoardRow))
        : rows.map(toView),
    })
  },

  /** 用当前 tab 的模块级缓存直接渲染列表（成功拉取 / 切 tab / 二次进入共用） */
  applyCachedToView() {
    const cache = cacheByKind[this.data.activeTab]
    this.setData(
      {
        loading: false,
        error: '',
        totalCount: cache.rawItems.length,
        updatedLabel: cache.lastSuccessAt ? buildUpdatedLabel(cache.lastSuccessAt) : '',
      },
      () => {
        this.refreshView()
        // 列表就绪后同步当前 tab 的分享海报数据（领涨 / 领跌双榜）
        this.refreshPosterData()
      },
    )
  },

  /** 拉取当前 tab 对应的板块分类全量清单（语义见 loadKind） */
  loadData(options?: { silent?: boolean }): Promise<void> {
    return this.loadKind(this.data.activeTab, options)
  },

  /**
   * 拉取指定板块分类的清单。
   * - A股：东财 clist/get 全量板块；美股：精选目录 + 成分实时聚合（fetchUsBoardRows）；
   * - 静默刷新（silent）：不闪 loading，成功原地更新缓存（若仍为当前 tab 则同步视图），
   *   失败保留旧数据；
   * - 常规加载（首屏 / 下拉 / 重试 / 首次切 tab）：展示 loading 与错误态
   *   （仅当该分类仍是当前 tab 时写入页面状态，避免切走后被旧请求覆盖）；
   * - 该分类已有请求进行中直接跳过（防并发）。
   */
  async loadKind(kind: TabKind, options?: { silent?: boolean }) {
    if (this.data.requestingByKind[kind]) return
    const { silent = false } = options ?? {}
    const meta = KIND_META[kind]
    const isActive = kind === this.data.activeTab
    lastListRequestAt = Date.now()
    this.setData({ requestingByKind: { ...this.data.requestingByKind, [kind]: true } })
    if (isActive && !silent) {
      this.setData({ loading: true, error: '' })
    }
    try {
      const items = isUsKind(kind)
        ? await fetchUsBoardRows(usCatalogKind(kind))
        : await fetchAllBoards(kind as BoardKind)
      const cache = cacheByKind[kind]
      if (!items.length) {
        cache.rawItems = []
        cache.loaded = false
        cache.lastSuccessAt = 0
        if (!silent && isActive) {
          this.setData({
            loading: false,
            error: meta.errorText,
            items: [],
            totalCount: 0,
            posterData: null,
          })
        }
        return
      }
      cache.rawItems = items
      cache.loaded = true
      cache.lastSuccessAt = Date.now()
      if (isActive) this.applyCachedToView()
    } catch (error) {
      console.warn(`[industry-all] ${meta.label}加载异常:`, error)
      if (!silent && isActive) {
        this.setData({
          loading: false,
          error: meta.errorText,
          items: [],
          totalCount: 0,
          posterData: null,
        })
      }
    } finally {
      this.setData({ requestingByKind: { ...this.data.requestingByKind, [kind]: false } })
    }
  },

  /**
   * 切换到指定板块分类（更新该分类的展示文案；按缓存状态决定加载策略）：
   * - 已有缓存：即时切换渲染，再后台静默刷新保鲜；
   * - 首次进入该分类：整页 loading 拉取。
   * onLoad（URL 参数初始 tab）与 onTabTap（手动点击切换）共用同一路径。
   */
  switchTab(kind: TabKind) {
    const meta = KIND_META[kind]
    const cache = cacheByKind[kind]
    this.setData({
      activeTab: kind,
      headerTitle: meta.headerTitle,
      searchPlaceholder: meta.searchPlaceholder,
      countUnit: meta.countUnit,
      loadingText: meta.loadingText,
      loadingDesc: meta.loadingDesc,
      dataNote: meta.dataNote,
      emptyText: meta.emptyText,
      error: '',
      // 清空海报：新分类数据未就绪前分享按钮只提示「内容加载中」（refreshPosterData 就绪后重填）
      posterData: null,
      // 分享原图的小程序入口：与当前 tab 一致，接收方从图上的「打开小程序」进入仍落在同分类
      shareEntrancePath: buildSharePath('industry-all', { tab: kind }),
    })
    if (cache.loaded) {
      // 已有缓存：即时切换渲染，再后台静默刷新保鲜
      this.applyCachedToView()
      void this.loadKind(kind, { silent: true })
    } else {
      // 首次进入该分类：整页 loading 拉取
      void this.loadKind(kind)
    }
  },

  /** 解析跳转参数指定的初始 tab（仅接受四类板块键值，非法 / 缺省回退 A股概念板块） */
  resolveInitialTab(raw?: string): TabKind {
    const tab = TAB_ORDER.find((kind) => kind === raw)
    return tab ?? 'concept'
  },

  /** 点击 tab：A股概念 ↔ A股行业 ↔ 美股概念 ↔ 美股行业 切换 */
  onTabTap(event: WechatMiniprogram.TouchEvent) {
    const target = event.currentTarget.dataset.kind as TabKind | undefined
    if (!target || !KIND_META[target] || target === this.data.activeTab) return
    this.switchTab(target)
  },

  // ---------------------------------------------------------------------------
  // 板块行 → 成分股弹窗
  // ---------------------------------------------------------------------------

  /** 当前板块行所属成分的取数器（A股 = 东财成分清单；美股 = 成分股实时聚合） */
  buildMemberLoader(): () => Promise<MemberRow[]> {
    const boardCode = this.data.memberBoardCode
    if (isUsKind(this.data.activeTab)) {
      return () => fetchUsBoardMembers(boardCode).then(toMemberRows)
    }
    return () => fetchBoardMembers(boardCode)
  },

  /** 点击板块行：弹出该板块成分股面板（按涨跌幅排序） */
  onBoardRowTap(event: WechatMiniprogram.TouchEvent) {
    const index = Number(event.currentTarget.dataset.index)
    const board = this.data.items[index]
    if (!board) return
    void this.openMemberPanel(board)
  },

  /** 打开成分股弹窗：同板块二次打开复用上次数据即时展示，再后台静默刷新保鲜 */
  async openMemberPanel(board: IndustryRowView) {
    const sameBoard = this.data.memberBoardCode === board.code && this.data.memberRawRows.length > 0
    if (sameBoard) {
      // 同板块二次打开：复用缓存数据，单次 setData 直接展示列表（避免中间态闪烁）
      this.setData({
        memberVisible: true,
        memberLoading: false,
        memberError: '',
        memberEmpty: false,
        memberBoardName: board.name,
        memberBoardCode: board.code,
        memberKindLabel: KIND_META[this.data.activeTab].label,
        memberItems: sortIndustryRows(this.data.memberRawRows, this.data.memberSortDir).map(toView),
      })
      await this.runMemberLoad(board.code, true, this.buildMemberLoader())
      return
    }
    // 新板块：单次 setData 置为加载态并清空旧内容，保证弹窗首帧就是 loading，不闪旧数据/空列表
    this.setData({
      memberVisible: true,
      memberLoading: true,
      memberError: '',
      memberEmpty: false,
      memberBoardName: board.name,
      memberBoardCode: board.code,
      memberKindLabel: KIND_META[this.data.activeTab].label,
      memberCount: 0,
      memberSortDir: 'desc',
      memberUpdatedLabel: '',
      memberRawRows: [],
      memberItems: [],
    })
    await this.runMemberLoad(board.code, false, this.buildMemberLoader())
  },

  /**
   * 拉取指定板块的全部成分股并渲染（入串行队列执行，避免并发）。
   * - silent：后台保鲜刷新，不闪 loading、失败保留现有数据；
   * - 常规：展示加载 / 失败态；
   * - loader：A股/美股的成分取数器（fetchBoardMembers / fetchUsBoardMembers）；
   * - 请求返回后仅当弹窗仍打开且目标板块未变才写入，过期结果直接丢弃
   *   （关闭弹窗后快速重开其它板块时，旧请求不会覆盖新标题内容）。
   */
  runMemberLoad(
    boardCode: string,
    silent: boolean,
    loader: () => Promise<MemberRow[]>,
  ): Promise<void> {
    const job = async () => {
      try {
        const rows = await loader()
        // 弹窗已关闭 / 用户已切换目标板块：丢弃过期结果
        if (!this.data.memberVisible || this.data.memberBoardCode !== boardCode) return
        if (!rows.length) {
          if (!silent) {
            this.setData({
              memberLoading: false,
              memberEmpty: true,
              memberCount: 0,
              memberRawRows: [],
              memberItems: [],
              memberUpdatedLabel: '',
            })
          }
          return
        }
        this.setData({
          memberLoading: false,
          memberError: '',
          memberEmpty: false,
          memberRawRows: rows,
          memberCount: rows.length,
          memberUpdatedLabel: buildUpdatedLabel(Date.now()),
          // 与 loading 同帧写入列表，避免先闪一帧空列表/旧排序
          memberItems: sortIndustryRows(rows, this.data.memberSortDir).map(toView),
        })
      } catch (error) {
        console.warn('[industry-all] 成分股加载异常:', error)
        if (!silent && this.data.memberVisible && this.data.memberBoardCode === boardCode) {
          this.setData({
            memberLoading: false,
            memberError: '成分股加载失败，请点击下方按钮重试',
            memberCount: 0,
            memberItems: [],
          })
        }
      }
    }
    const next = memberChain.then(job)
    // 队列继续传递：任何一次失败都不阻塞后续排队任务
    memberChain = next.catch(() => undefined).then(() => undefined)
    return next
  },

  /** 重算成分股展示列表（内存排序，不重新请求） */
  applyMemberView() {
    const rows = sortIndustryRows(this.data.memberRawRows, this.data.memberSortDir)
    this.setData({ memberItems: rows.map(toView) })
  },

  onMemberSortToggle() {
    const next: PctSortDir = this.data.memberSortDir === 'desc' ? 'asc' : 'desc'
    this.setData({ memberSortDir: next }, () => this.applyMemberView())
  },

  onMemberRetry() {
    this.setData({ memberLoading: true, memberError: '' })
    // 取数器按当前板块代码实时重建（memberBoardCode 已就位），无需额外状态
    void this.runMemberLoad(this.data.memberBoardCode, false, this.buildMemberLoader())
  },

  onMemberClose() {
    this.setData({ memberVisible: false })
  },

  /** 拦截弹窗蒙层上的滚动，避免带动下层页面滚动（内容滚动由弹窗内 scroll-view 自理） */
  onMemberMaskTouch() {
    // no-op
  },

  /** 点击成分股：进当日分时图（minute 页：分时 + 基础信息，作个股详情入口） */
  onMemberRowTap(event: WechatMiniprogram.TouchEvent) {
    const index = Number(event.currentTarget.dataset.index)
    const member = this.data.memberItems[index]
    if (!member) return
    if (member.mcode) {
      // 美股成分股：mcode = 东财 secid（105./106./107. 前缀），minute 页按 EM_US_SECID_RE 直连
      const query = `code=${encodeURIComponent(member.mcode)}&name=${encodeURIComponent(member.name)}`
      wx.navigateTo({ url: `/packageQuote/pages/minute/index?${query}` })
      return
    }
    const tcCode = ashareTcCode(member.code)
    const query = `code=${tcCode}&name=${encodeURIComponent(member.name)}`
    wx.navigateTo({ url: `/packageQuote/pages/minute/index?${query}` })
  },

  onRetry() {
    void this.loadData()
  },

  /** 搜索框输入：名称/代码过滤（内存过滤，作用于当前 tab） */
  onSearchInput(event: WechatMiniprogram.BaseEvent & { detail: { value: string } }) {
    this.setData({ query: event.detail.value ?? '' }, () => this.refreshView())
  },

  onSearchClear() {
    this.setData({ query: '' }, () => this.refreshView())
  },

  /** 涨跌幅排序：点击切换 领涨榜（降序）/ 领跌榜（升序） */
  onSortToggle() {
    const next: PctSortDir = this.data.sortDir === 'desc' ? 'asc' : 'desc'
    this.setData({ sortDir: next }, () => this.refreshView())
  },

  /**
   * 组装当前 tab 的分享海报数据：标题用当前分类（A股概念 / 行业 / 美股概念 / 行业），
   * 主体分「领涨板块」「领跌板块」双榜各取前 POSTER_BOARD_LIMIT 名（板块名 + 涨跌幅），
   * 数据取模块级缓存全量（与列表过滤 / 排序无关），仅在分类有有效行情时生成。
   */
  refreshPosterData() {
    const kind = this.data.activeTab
    const meta = KIND_META[kind]
    const cache = cacheByKind[kind]
    if (!cache.loaded || !cache.rawItems.length) {
      this.setData({ posterData: null })
      return
    }
    // 仅收录有涨跌幅的板块（无数据行「--」不入榜，避免占位干扰榜单可读性）
    const rows = cache.rawItems.filter((item) => item.pct !== null)
    if (!rows.length) {
      this.setData({ posterData: null })
      return
    }
    const toPosterRow = (item: IndustryBoardRow): PosterRow => {
      const view = computeChangeView(item.pct)
      return {
        name: item.name,
        value: '',
        changeText: view.changeText,
        tone: view.changeClass as PosterTone,
      }
    }
    const sections: PosterSection[] = []
    const leaders = sortIndustryRows(rows, 'desc').slice(0, POSTER_BOARD_LIMIT).map(toPosterRow)
    if (leaders.length) sections.push({ title: '领涨板块', rows: leaders, compact: true })
    const laggards = sortIndustryRows(rows, 'asc').slice(0, POSTER_BOARD_LIMIT).map(toPosterRow)
    if (laggards.length) sections.push({ title: '领跌板块', rows: laggards, compact: true })
    if (!sections.length) {
      this.setData({ posterData: null })
      return
    }
    this.setData({
      posterData: {
        title: meta.headerTitle,
        subtitle: APP_NAME,
        statusText: `共 ${cache.rawItems.length} 个${meta.countUnit}`,
        stamp: formatShareStamp(new Date()),
        includeWatermark: true,
        sections,
      },
    })
  },

  /** 顶栏分享按钮：调起 share-poster 组件按当前 tab 的海报数据生成并预览 */
  onSharePoster() {
    const poster = this.selectComponent('#sharePoster') as unknown as { open(): void } | null
    if (poster) poster.open()
  },

  /**
   * 右上角胶囊菜单的系统默认分享：与其他页面一致「经首页中转」——
   * 卡片 path 带当前 tab 走 utils/share.ts buildSharePath，接收方先进首页再自动跳回本页同分类；
   * 图片分享（分享海报的 entrancePath）与此共用同一路径（见 switchTab 的 shareEntrancePath）。
   */
  onShareAppMessage(): WechatMiniprogram.Page.ICustomShareContent {
    trackEvent('share.trigger')
    const meta = KIND_META[this.data.activeTab]
    return {
      title: meta.headerTitle,
      path: buildSharePath('industry-all', { tab: this.data.activeTab }),
      imageUrl: SHARE_IMAGE_URL,
    }
  },

  onUnload() {
    stopAutoRefresh(this)
    unbindTheme(this)
  },
})
