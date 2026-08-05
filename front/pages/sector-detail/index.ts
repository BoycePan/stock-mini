import { sectorApi } from '../../api/sector'
import { getTheme, type ThemeMode } from '../../utils/storage'
import type { SectorBoard } from '../../types/stock'

Page({
  data: {
    theme: getTheme() as ThemeMode,
    loading: true,
    title: '板块详情',
    code: '',
    cid: 0,
    boards: [] as SectorBoard[],
    members: [] as string[],
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
  async loadData() {
    this.setData({ loading: true, error: '' })
    try {
      const [boards, members] = await Promise.all([
        sectorApi.getBoards(20),
        this.data.cid ? sectorApi.getMembers(this.data.cid) : Promise.resolve([] as string[]),
      ])
      this.setData({ loading: false, boards, members })
    } catch (error) {
      this.setData({
        loading: false,
        error: error instanceof Error ? error.message : '板块数据加载失败',
      })
    }
  },
})
