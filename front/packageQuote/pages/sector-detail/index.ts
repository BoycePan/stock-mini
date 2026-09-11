import { sectorApi } from '../../../api/sector'
import { rootStore } from '../../../stores/root.store'
import { stockApi } from '../../../api/stock'
import type { KlinePoint, SectorBoard } from '../../../types/stock'
import { computeChangeView } from '../../../utils/market'
import {
  APP_NAME,
  formatShareStamp,
  type PosterData,
  type PosterTone,
} from '../../../utils/share-poster'
import { bindTheme, unbindTheme } from '../../../utils/theme'
import { trackEvent } from '../../../utils/tracker'
import { buildSharePath, SHARE_IMAGE_URL } from '../../../utils/share'

const MEMBER_QUOTE_LIMIT = 20

/**
 * 已卸载的页面实例：K 线请求在途时用户返回上一页，响应回来不能再 setData
 * （页面已销毁，写入无效且旧请求的失败 toast 会打扰用户）。写法与
 * packageNews/pages/news-detail 的 destroyedPages 一致。
 */
const destroyedPages = new WeakSet<object>()
/**
 * 实例 → 最新一次 K 线请求序号（WeakMap 随实例回收，不泄漏）：
 * 连点板块 A→B 时 A 的响应可能晚于 B 返回，只有序号仍是「本实例最新一次请求」才允许写入。
 */
const klineSeq = new WeakMap<object, number>()

interface MemberView {
  code: string
  name: string
  priceText: string
  changeText: string
  changeClass: string
}

Page({
  data: {
    theme: rootStore.settings.theme,
    loading: true,
    title: '板块详情',
    code: '',
    cid: 0,
    boards: [] as SectorBoard[],
    selectedBoard: null as SectorBoard | null,
    klines: [] as KlinePoint[],
    members: [] as MemberView[],
    memberTotal: 0,
    error: '',
    posterData: null as PosterData | null,
    /** 分享原图（wx.showShareImageMenu）的小程序入口路径：与卡片分享一致经首页中转（utils/share.ts） */
    shareEntrancePath: '',
  },
  async onLoad(options: Record<string, string | undefined>) {
    bindTheme(this)
    const code = options.code || ''
    const cid = Number(options.cid || 0)
    const name = options.name || '板块详情'
    this.setData({
      code,
      cid,
      title: name,
      // 分享原图的小程序入口：与 onShareAppMessage 卡片分享同一路径（经首页中转），
      // 接收方按 code/cid/name 还原同一板块，避免默认入口落在「当前页且无参数」导致无法加载；
      // 分享路径统一不带前导斜杠（见 utils/share.ts 的 buildSharePath）
      shareEntrancePath: buildSharePath('sector-detail', {
        code,
        cid: cid ? String(cid) : undefined,
        name,
      }),
    })
    await this.loadData()
  },
  async onPullDownRefresh() {
    try {
      await this.loadData()
    } finally {
      wx.stopPullDownRefresh()
    }
  },
  async loadData() {
    this.setData({ loading: true, error: '' })
    try {
      const [boards, memberCodes] = await Promise.all([
        sectorApi.getBoards(20),
        this.data.cid ? sectorApi.getMembers(this.data.cid) : Promise.resolve([] as string[]),
      ])
      const members = await this.buildMembers(memberCodes)
      this.setData({
        loading: false,
        boards,
        members,
        memberTotal: memberCodes.length,
        error: '',
      })
      const current = this.data.selectedBoard ?? boards[0]
      if (current) await this.loadKlines(current)
    } catch (error) {
      this.setData({
        loading: false,
        error: error instanceof Error ? error.message : '板块数据加载失败',
      })
    }
  },
  async buildMembers(codes: string[]): Promise<MemberView[]> {
    if (!codes.length) return []
    const quotes = await stockApi.getQuotes(codes.slice(0, MEMBER_QUOTE_LIMIT))
    return quotes.map((quote) => ({
      code: quote.code,
      name: quote.name,
      priceText: String(quote.price),
      ...computeChangeView(quote.pct_change),
    }))
  },
  async loadKlines(board: SectorBoard) {
    // 先登记本次请求序号（自增）：响应回来时据此判断是否已被后一次点击取代
    const seq = (klineSeq.get(this) ?? 0) + 1
    klineSeq.set(this, seq)
    this.setData({ selectedBoard: board, klines: [] })
    try {
      const result = await sectorApi.getKlines(board.plate_code, '240', 60)
      // 过期响应直接丢弃：否则会把板块 A 的 K 线画在标题 / 高亮已是 B 的面板里（用户读到错误标的）
      if (!this.isLatestKlines(seq, board)) return
      this.setData({ klines: result.klines, posterData: this.buildPosterData() })
    } catch {
      // catch 同样要判过期：旧请求的失败 toast 会在新板块已加载成功后再弹一次，干扰用户
      if (!this.isLatestKlines(seq, board)) return
      this.setData({ klines: [], posterData: this.buildPosterData() })
      wx.showToast({ title: '板块K线加载失败', icon: 'none' })
    }
  },
  /**
   * 是否仍可写入本次请求结果，三个条件缺一不可：
   * - 页面未卸载（卸载后写入无效，且不该再弹 toast）；
   * - 仍是本实例最新一次 K 线请求（连点板块 A→B 时 A 的响应可能晚于 B）；
   * - 当前选中板块未变（下拉刷新等路径可能已把 selectedBoard 换成其它板块）。
   */
  isLatestKlines(seq: number, board: SectorBoard): boolean {
    if (destroyedPages.has(this)) return false
    if (klineSeq.get(this) !== seq) return false
    return this.data.selectedBoard?.plate_code === board.plate_code
  },
  onBoardTap(event: WechatMiniprogram.BaseEvent) {
    const index = (event.currentTarget as unknown as { dataset: { index?: number } }).dataset.index
    if (index === undefined) return
    const board = this.data.boards[index]
    if (!board || board.plate_code === this.data.selectedBoard?.plate_code) return
    // 不 await：连点多个板块时后一次点击立即发起新请求，过期响应由 isLatestKlines 丢弃
    void this.loadKlines(board)
  },
  onUnload() {
    // 先置销毁标记：在途 K 线响应回来时据此短路，不再对已销毁页面 setData
    destroyedPages.add(this)
    unbindTheme(this)
  },
  /** 组装分享海报数据（板块信息 + 成分股涨幅榜；K 线图由 share-poster 组件按 klines 绘制） */
  buildPosterData(): PosterData {
    const board = this.data.selectedBoard
    const memberRows = this.data.members.slice(0, 6).map((member) => ({
      name: member.name,
      value: member.priceText,
      changeText: member.changeText,
      tone: (member.changeClass === 'up'
        ? 'up'
        : member.changeClass === 'down'
          ? 'down'
          : 'flat') as PosterTone,
    }))
    return {
      title: (board && board.plate_name) || this.data.title,
      subtitle: APP_NAME,
      statusText: (board && board.plate_code) || '板块K线',
      stamp: formatShareStamp(new Date()),
      includeWatermark: true,
      sections: [
        {
          title: '板块信息',
          rows: [
            {
              name: '板块代码',
              value: (board && board.plate_code) || '',
              changeText: '',
              tone: 'flat',
            },
            { name: '成分股', value: String(this.data.memberTotal), changeText: '', tone: 'flat' },
          ],
        },
        ...(memberRows.length ? [{ title: '成分股涨幅榜', rows: memberRows }] : []),
      ],
    }
  },
  /** 顶栏分享按钮：调起 share-poster 组件生成并预览海报 */
  onSharePoster() {
    const poster = this.selectComponent('#sharePoster') as unknown as { open(): void } | null
    if (poster) poster.open()
  },
  onMemberTap(event: WechatMiniprogram.BaseEvent) {
    const index = (event.currentTarget as unknown as { dataset: { index?: number } }).dataset.index
    if (index === undefined) return
    const member = this.data.members[index]
    if (!member) return
    wx.navigateTo({ url: `/packageQuote/pages/stock-detail/index?code=${member.code}` })
  },
  onShareAppMessage(): WechatMiniprogram.Page.ICustomShareContent {
    trackEvent('share.trigger')
    return {
      title: this.data.title || '板块详情',
      // 分享统一经首页中转：先进入首页，再自动跳转到本页（见 utils/share.ts）
      path: buildSharePath('sector-detail', {
        code: this.data.code,
        cid: this.data.cid ? String(this.data.cid) : undefined,
        name: this.data.title,
      }),
      imageUrl: SHARE_IMAGE_URL,
    }
  },
})
