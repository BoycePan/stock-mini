/**
 * 验证脚本专用的 `wx.request` 垫片（Node 侧用 fetch 实现，语义对齐微信）。
 *
 * 用途：`scripts/verify-*.ts` 直接调用生产代码路径（api/* → requestExternal → wx.request）
 * 做真实网络连通性验证，因此在进程内注入本垫片，脚本里不再另写一套请求 + 解析。
 *
 * 语义对齐点：
 * - 仅 2xx 视为成功，其余走 fail（与 api/external.ts 的判定一致）；
 * - 响应体先按文本读取，能 JSON.parse 则回传对象（微信对 application/json 自动解析），
 *   否则原样回传字符串（JSONP / 管道分隔文本，交给对应解析器）；
 * - 支持 responseType: 'arraybuffer'（api/external.ts 的 GBK 场景）；
 * - timeout 用 AbortController 实现（默认 25s，覆盖新浪期货日线这类大响应）。
 */

/** 与 api/external.ts 的请求参数同形（只声明垫片用到的字段） */
export interface WxRequestOptions {
  url: string
  method?: string
  timeout?: number
  header?: Record<string, string>
  responseType?: 'arraybuffer'
  success?: (response: { statusCode: number; data: unknown }) => void
  fail?: (error: { errMsg: string }) => void
}

/** 默认超时（ms）：大于 api/kline.ts 里最长的 20s（新浪期货日线全量历史） */
const DEFAULT_TIMEOUT_MS = 25000

/**
 * 默认 User-Agent：微信小程序的 wx.request 自带 MicroMessenger UA，
 * 而 Node 的 fetch 默认发 `undici` —— 东财 push2his 对非浏览器 UA 会直接空响应/拒连
 * （server 侧风控，见 api/kline.ts 头部说明），故垫片默认补一个移动端浏览器 UA。
 * 调用方 header 里的 User-Agent 优先（如 verify-minute.ts 的 Mozilla/5.0）。
 */
const DEFAULT_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 ' +
  '(KHTML, like Gecko) Mobile/15E148 MicroMessenger/8.0.49(0x18003128) NetType/WIFI'

/** 在全局注入 wx.request 垫片（重复调用会覆盖上一次注入） */
export function installWxRequestShim(): void {
  const request = (options: WxRequestOptions): void => {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), options.timeout ?? DEFAULT_TIMEOUT_MS)
    const headers = { 'User-Agent': DEFAULT_UA, ...options.header }
    void fetch(options.url, {
      method: options.method ?? 'GET',
      headers,
      signal: controller.signal,
    })
      .then(async (response) => {
        clearTimeout(timer)
        if (response.status < 200 || response.status >= 300) {
          options.fail?.({ errMsg: `request:fail HTTP ${response.status}` })
          return
        }
        if (options.responseType === 'arraybuffer') {
          options.success?.({
            statusCode: response.status,
            data: await response.arrayBuffer(),
          })
          return
        }
        const text = await response.text()
        let data: unknown = text
        try {
          data = JSON.parse(text)
        } catch {
          // 非 JSON：原样回传字符串
        }
        options.success?.({ statusCode: response.status, data })
      })
      .catch((error: unknown) => {
        clearTimeout(timer)
        const errMsg = error instanceof Error ? error.message : String(error)
        options.fail?.({ errMsg: `request:fail ${errMsg}` })
      })
  }
  ;(globalThis as unknown as { wx: { request: typeof request } }).wx = { request }
}
