import type { KlineResult, SectorBoard, SectorMembersResponse } from '../types/stock'
import { unwrapSectorMemberCodes } from '../utils/api-normalizers'
import { request } from './client'

export const sectorApi = {
  getBoards(top = 20) {
    return request<SectorBoard[]>({
      path: '/api/v1/sector/boards',
      query: { top },
      // 后端 /api/v1/** 强制鉴权（除 auth）：必须带 Bearer token，否则返回「缺少 token」
      withAuth: true,
    })
  },
  getKlines(code: string, _scale = '240', count = 100) {
    return request<KlineResult>({
      path: `/api/v1/sector/board/${code}/klines`,
      query: { count },
      withAuth: true,
    })
  },
  async getMembers(cid: number) {
    const response = await request<SectorMembersResponse>({
      path: `/api/v1/sector/members/${cid}`,
      withAuth: true,
    })
    return unwrapSectorMemberCodes(response)
  },
}
