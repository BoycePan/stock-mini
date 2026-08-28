import type { AppConfig, Notice } from '../types/system'
import { LOGIN_SOURCE } from '../config/app'
import { request } from './client'

/**
 * 系统配置与公告读取（docs/API.md 八）。
 * 这两个接口由全局就绪门闩（rootStore.bootstrap）在登录完成后内部调用，
 * 因此必须跳过门闩（skipLoginWait），否则配置接口会等待自身就绪造成死锁。
 */
export const systemApi = {
  /** 前端展示配置：摊平 JSON 对象，只含「启用 + 命中分端」的配置项 */
  configs(cfgType: 'login' | 'display' | 'other' = 'display') {
    return request<AppConfig>({
      path: '/api/v1/configs',
      query: { source: LOGIN_SOURCE, cfgType },
      withAuth: true,
      skipLoginWait: true,
    })
  },
  /** 公告列表：仅「启用 + 命中分端 + 有效期内」，position 缺省返回该端全部位置 */
  notices(position?: string) {
    return request<Notice[]>({
      path: '/api/v1/notices',
      query: { source: LOGIN_SOURCE, position },
      withAuth: true,
      skipLoginWait: true,
    })
  },
}
