import { sectorApi } from '../../api/sector'
import { stockApi } from '../../api/stock'
import { getTheme, type ThemeMode } from '../../utils/storage'
import type { KlinePoint, SectorBoard } from '../../types/stock'
import { formatChange } from '../../utils/formatter'

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
    theme: getTheme() as ThemeMode,
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
  },
  async onLoad(options: Record<string, string | undefined>) {
    this.setData({
      code: options.code || '',
      cid: Number(options.cid || 0),
      title: options.name || '板块详情',
    })
    await this.loadData()
  },
  onShow() {
    this.setData({ theme: getTheme() })
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
      this.setData({ klines: result.klines })
    } catch {
      this.setData({ klines: [] })
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
  onMemberTap(event: WechatMiniprogram.BaseEvent) {
    const index = (event.currentTarget as unknown as { dataset: { index?: number } }).dataset.index
    if (index === undefined) return
    const member = this.data.members[index]
    if (!member) return
    wx.navigateTo({ url: `/pages/stock-detail/index?code=${member.code}` })
  },
})
