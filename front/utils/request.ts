import { getEnv } from '../config/env'
import type { ApiResponse, RequestMethod } from '../types/api'
import { getToken } from './storage'

export interface RequestOptions {
  path: string
  method?: RequestMethod
  data?: Record<string, unknown> | string
  query?: Record<string, string | number | boolean | undefined>
  withAuth?: boolean
  /** 跳过登录门闩：登录接口自身（避免死锁）以及无需鉴权的公开页面（如财经页）使用 */
  skipLoginWait?: boolean
}

type LoginWaiter = () => Promise<void>
let loginWaiter: LoginWaiter | null = null

/**
 * 注册「登录门闩」：除登录接口外的所有请求发送前都会先 await 它，
 * 保证打开小程序先登录、接口都在登录完成后执行。
 */
export function setLoginWaiter(waiter: LoginWaiter | null): void {
  loginWaiter = waiter
}

function buildQuery(query?: RequestOptions['query']): string {
  if (!query) return ''
  const params = Object.entries(query).filter(([, value]) => value !== undefined && value !== '')
  if (!params.length) return ''
  return `?${params.map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`).join('&')}`
}

export async function request<T>({
  path,
  method = 'GET',
  data,
  query,
  withAuth = false,
  skipLoginWait = false,
}: RequestOptions): Promise<T> {
  // 除登录接口外的所有请求，都等登录完成后才发送
  if (!skipLoginWait && loginWaiter) {
    await loginWaiter()
  }
  const env = getEnv()
  const url = `${env.apiBaseUrl}${path}${buildQuery(query)}`
  const token = getToken()

  return new Promise<T>((resolve, reject) => {
    wx.request<ApiResponse<T>>({
      url,
      method,
      data,
      timeout: env.requestTimeout,
      header: {
        'content-type': 'application/json',
        ...(withAuth && token ? { Authorization: `Bearer ${token}` } : {}),
      },
      success: (response) => {
        const body = response.data
        if (body.code === 200 && body.data !== undefined) {
          resolve(body.data)
          return
        }
        if (body.code === 200) {
          resolve(undefined as T)
          return
        }
        const error = new Error(body.msg || '请求失败') as Error & { code?: number }
        error.code = body.code
        reject(error)
      },
      fail: (error) => {
        const networkError = new Error(error.errMsg || '网络请求失败') as Error & {
          isNetworkError?: boolean
        }
        networkError.isNetworkError = true
        reject(networkError)
      },
    })
  })
}
