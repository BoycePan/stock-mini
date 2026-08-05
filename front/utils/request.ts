import { getEnv } from '../config/env'
import type { ApiResponse, RequestMethod } from '../types/api'
import { getToken } from './storage'

export interface RequestOptions {
  path: string
  method?: RequestMethod
  data?: Record<string, unknown> | string
  query?: Record<string, string | number | boolean | undefined>
  withAuth?: boolean
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
}: RequestOptions): Promise<T> {
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
