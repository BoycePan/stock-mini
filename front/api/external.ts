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
  /**
   * 以原始字节（ArrayBuffer）返回响应，用于新浪/腾讯等 GBK 文本行情：
   * 微信 wx.request 默认按 UTF-8 解码响应，遇到 GBK 字节会直接失败
   * （request:fail response data convert to UTF8 fail），且小程序端无 GBK TextDecoder。
   */
  responseType?: 'arraybuffer'
}

/**
 * 将请求返回的原始字节（ArrayBuffer）逐字节还原为文本（按 ISO-8859-1/Latin-1 逐字节对应）。
 *
 * 背景：微信 wx.request 默认按 UTF-8 解码响应，遇到新浪/腾讯等 GBK 文本会直接失败
 * （request:fail response data convert to UTF8 fail），且小程序端无 GBK TextDecoder。
 * 本函数先按字节保留——不丢字节、也不破坏数字/ASCII 结构；GBK 中文名（呈现层多为
 * displayName() 回退配置名兜底）保留原始字节，数值类字段均为 ASCII，解析不受影响。
 */
export function rawBytesToString(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  const CHUNK = 0x8000
  const parts: string[] = []
  for (let i = 0; i < bytes.length; i += CHUNK) {
    const sub = Array.from(bytes.subarray(i, i + CHUNK))
    parts.push(String.fromCharCode.apply(null, sub))
  }
  return parts.join('')
}

export function requestExternal<T>(url: string, options: ExternalRequestOptions = {}): Promise<T> {
  const { method = 'GET', data, timeout = 10000, referer, responseType } = options
  const header: Record<string, string> = { 'content-type': 'text/plain' }
  if (referer) header.Referer = referer

  return new Promise<T>((resolve, reject) => {
    wx.request({
      url,
      method,
      data,
      timeout,
      header,
      ...(responseType ? { responseType } : {}),
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
