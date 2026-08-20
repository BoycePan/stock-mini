/**
 * 外部 HTTP 接口直连层（docs/tabbar-api.md 公共请求约定）。
 *
 * 与 utils/request.ts（后端接口）不同：
 * - 不走登录门闩、不套 { code, msg, data } 响应壳；
 * - 直接返回原始响应（文本或 JSON 对象）；
 * - 支持按接口配置超时与 Referer。
 */

export interface ExternalRequestOptions {
  method?: 'GET' | 'POST'
  data?: string | Record<string, unknown>
  /** 超时（毫秒）：新浪 12000、腾讯 10000、跳转配置 8000 */
  timeout?: number
  /** Referer（新浪接口必须带 https://finance.sina.com.cn，腾讯建议带 https://qt.gtimg.cn） */
  referer?: string
}

export function requestExternal<T>(url: string, options: ExternalRequestOptions = {}): Promise<T> {
  const { method = 'GET', data, timeout = 10000, referer } = options
  const header: Record<string, string> = { 'content-type': 'text/plain' }
  if (referer) header.Referer = referer

  return new Promise<T>((resolve, reject) => {
    wx.request({
      url,
      method,
      data,
      timeout,
      header,
      success: (response) => {
        if (response.statusCode >= 200 && response.statusCode < 300) {
          resolve(response.data as T)
          return
        }
        reject(new Error(`外部接口返回 ${response.statusCode}: ${url}`))
      },
      fail: (error) => {
        reject(new Error(error.errMsg || `外部接口请求失败: ${url}`))
      },
    })
  })
}
