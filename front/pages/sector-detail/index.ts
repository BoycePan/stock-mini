import { sectorApi } from '../../api/sector'
import { rootStore } from '../../stores/root.store'
import { stockApi } from '../../api/stock'
import type { KlinePoint, SectorBoard } from '../../types/stock'
import { formatChange } from '../../utils/formatter'
import {
  APP_NAME,
  formatShareStamp,
  type PosterData,
  type PosterTone,
} from '../../utils/share-poster'
import { bindTheme, unbindTheme } from '../../utils/theme'
import { buildSharePath, SHARE_IMAGE_URL } from '../../utils/share'

const MEMBER_QUOTE_LIMIT = 20

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
  },
  async onLoad(options: Record<string, string | undefined>) {
    bindTheme(this)
    this.setData({
      code: options.code || '',
      cid: Number(options.cid || 0),
      title: options.name || '板块详情',
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
      changeText: formatChange(quote.pct_change),
      changeClass: quote.pct_change >= 0 ? 'up' : 'down',
    }))
  },
  async loadKlines(board: SectorBoard) {
    this.setData({ selectedBoard: board, klines: [] })
    try {
      const result = await sectorApi.getKlines(board.plate_code, '240', 60)
      this.setData({ klines: result.klines, posterData: this.buildPosterData() })
    } catch {
      this.setData({ klines: [], posterData: this.buildPosterData() })
      wx.showToast({ title: '板块K线加载失败', icon: 'none' })
    }
  },
  onBoardTap(event: WechatMiniprogram.BaseEvent) {
    const index = (event.currentTarget as unknown as { dataset: { index?: number } }).dataset.index
    if (index === undefined) return
    const board = this.data.boards[index]
    if (!board || board.plate_code === this.data.selectedBoard?.plate_code) return
    this.loadKlines(board)
  },
  onUnload() {
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
    wx.navigateTo({ url: `/pages/stock-detail/index?code=${member.code}` })
  },
  onShareAppMessage(): WechatMiniprogram.Page.ICustomShareContent {
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
