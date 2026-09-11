import { getEnv } from '../config/env'
import type { ApiResponse, RequestMethod } from '../types/api'
import { getToken } from './storage'

export interface RequestOptions {
  path: string
  method?: RequestMethod
  data?: Record<string, unknown> | string
  query?: Record<string, string | number | boolean | undefined>
  withAuth?: boolean
  /** 跳过就绪门闩：仅登录 / 系统配置接口使用（它们在门闩内部执行，避免死锁） */
  skipLoginWait?: boolean
}

type ReadyWaiter = () => Promise<void>
let readyWaiter: ReadyWaiter | null = null

/**
 * 注册「全局就绪门闩」：除登录接口与系统配置接口（它们在门闩内部执行）外，
 * 所有业务请求发送前都会先 await 它，保证「登录 + 系统配置」就绪后才放行。
 */
export function setReadyWaiter(waiter: ReadyWaiter | null): void {
  readyWaiter = waiter
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
  // 除登录接口与系统配置接口（门闩内部执行）外，所有业务请求都等全局就绪后发送
  if (!skipLoginWait && readyWaiter) {
    await readyWaiter()
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
        // 响应体解析必须包在 try/catch 内：wx 的 success 回调是异步调用的，
        // 这里抛出的异常不会回到下面的 Promise 执行器，会让 Promise 既不 resolve
        // 也不 reject（永久 pending）——对调用方意味着 inFlight 永不清除、页面永久 loading。
        try {
          const body = response.data
          if (!body || typeof body !== 'object') {
            reject(new Error('响应格式异常'))
            return
          }
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
        } catch (parseError) {
          reject(parseError instanceof Error ? parseError : new Error('响应解析失败'))
        }
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
