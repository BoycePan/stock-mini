import type { KlineResult, SectorBoard, SectorMembersResponse } from '../types/stock'
import { unwrapSectorMemberCodes } from '../utils/api-normalizers'
import { request } from './client'

export const sectorApi = {
  getBoards(top = 20) {
    return request<SectorBoard[]>({ path: '/api/v1/sector/boards', query: { top } })
  },
  getKlines(code: string, _scale = '240', count = 100) {
    return request<KlineResult>({
      path: `/api/v1/sector/board/${code}/klines`,
      query: { count },
    })
  },
  async getMembers(cid: number) {
    const response = await request<SectorMembersResponse>({ path: `/api/v1/sector/members/${cid}` })
    return unwrapSectorMemberCodes(response)
  },
}
