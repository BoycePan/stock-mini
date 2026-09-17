/**
 * 分时页「按 code 优先级从前到后兜底」的执行语义测试（离线，stub wx.request）。
 *
 * 覆盖：
 *  - 首选源成功即返回，不再请求后续源；
 *  - 首选源失败（点数不足）→ 自动切下一个源（东财）；
 *  - 源级失败熔断：同一 code 的失败源在 TTL 内不再重复请求；resetMinuteSourceBreaker 后恢复尝试；
 *  - 基础信息报价：腾讯快照有效即用，字段不足/无效时自动切东财 ulist；
 *  - 时段网格裁剪：腾讯 A股个股 15:06–15:30 盘后尾段被裁掉（保住图表的时段铺格）。
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import {
  fetchMinuteBasicQuote,
  fetchMinuteData,
  resetMinuteSourceBreaker,
} from '../utils/minute.ts'
import { parseMinuteOfDay } from '../utils/minute-session.ts'

// ---------------------------------------------------------------------------
// wx.request 垫片：按 URL 路由返回预置响应，并记录请求次数
// ---------------------------------------------------------------------------

interface StubState {
  requests: string[]
  /** 腾讯分时返回的行（默认给足 3 点；置为空/单点可模拟失败） */
  tencentMinuteRows: string[]
  /** 腾讯快照文本（null = 模拟字段不足/无效） */
  tencentSnapshot: string | null
  /** 东财 ulist 是否返回有效报价 */
  eastmoneyQuoteValid: boolean
}

const state: StubState = {
  requests: [],
  tencentMinuteRows: [],
  tencentSnapshot: null,
  eastmoneyQuoteValid: true,
}

function textToBuffer(text: string): ArrayBuffer {
  const bytes = new Uint8Array(text.length)
  for (let i = 0; i < text.length; i += 1) bytes[i] = text.charCodeAt(i) & 0xff
  return bytes.buffer
}

/** 构造腾讯快照文本（实测布局：[5]今开 [33]最高 [34]最低 [36]成交量） */
function tencentSnapshotLine(): string {
  const fields = new Array(40).fill('0')
  fields[0] = '1'
  fields[1] = 'Moutai'
  fields[2] = '600519'
  fields[3] = '1266.98' // 现价
  fields[4] = '1258.00' // 昨收
  fields[5] = '1257.98' // 今开
  fields[6] = '17554' // 成交量（手）
  fields[30] = '20260917150000'
  fields[31] = '8.98'
  fields[32] = '0.71'
  fields[33] = '1267.60' // 最高
  fields[34] = '1254.00' // 最低
  fields[36] = '17554' // 成交量
  return `v_sh600519="${fields.join('~')}";`
}

function installStub(): void {
  ;(globalThis as unknown as { wx: unknown }).wx = {
    request(options: {
      url: string
      responseType?: string
      success?: (res: { statusCode: number; data: unknown }) => void
      fail?: (err: { errMsg: string }) => void
    }) {
      state.requests.push(options.url)
      const respond = (data: unknown) => options.success?.({ statusCode: 200, data: data as never })
      if (options.url.includes('web.ifzq.gtimg.cn')) {
        respond({
          code: 0,
          data: {
            sh600519: {
              data: { data: state.tencentMinuteRows },
              qt: { sh600519: ['1', 'Moutai', '600519', '1266.98', '1258.00'] },
            },
          },
        })
        return
      }
      if (options.url.includes('/q=sh600519')) {
        if (state.tencentSnapshot === null) {
          respond(textToBuffer('v_sh600519="pv_none_match";'))
          return
        }
        respond(textToBuffer(state.tencentSnapshot))
        return
      }
      if (options.url.includes('trends2/get')) {
        respond({
          data: {
            preClose: 1258,
            trends: [
              '2026-09-17 09:30,1257.98,140,1257.980',
              '2026-09-17 09:31,1261.98,432,1258.198',
            ],
          },
        })
        return
      }
      if (options.url.includes('ulist.np/get')) {
        // 只有 A股 600519 的 secid 才给数据（其余标的模拟「上游无报价」）
        const forSh600519 = decodeURIComponent(options.url).includes('secids=1.600519')
        respond({
          data: {
            diff:
              state.eastmoneyQuoteValid && forSh600519
                ? [
                    {
                      f12: '600519',
                      f13: '1',
                      f2: 1266.98,
                      f3: 0.71,
                      f17: 1257.98,
                      f15: 1267.6,
                      f16: 1254,
                      f18: 1258,
                      f5: 17554,
                    },
                  ]
                : [],
          },
        })
        return
      }
      options.fail?.({ errMsg: `unexpected url ${options.url}` })
    },
  }
}

installStub()

function resetState(overrides: Partial<StubState> = {}): void {
  state.requests = []
  state.tencentMinuteRows = []
  state.tencentSnapshot = null
  state.eastmoneyQuoteValid = true
  Object.assign(state, overrides)
  resetMinuteSourceBreaker()
}

const realRows = [
  '0930 1257.98 140 17611720.00',
  '0931 1261.98 572 71968937.77',
  '0932 1261.82 1052 132616485.58',
]

// ---------------------------------------------------------------------------
// 分时序列：首选成功即返回 / 失败自动切下一个
// ---------------------------------------------------------------------------

test('分时：腾讯（首选）返回有效多点 → 命中腾讯，不再请求东财', async () => {
  resetState({ tencentMinuteRows: realRows })
  const result = await fetchMinuteData('sh600519')
  assert.ok(result)
  assert.equal(result.source, 'tc')
  assert.equal(result.sourceLabel, '腾讯分时')
  assert.equal(result.points.length, 3)
  assert.equal(result.preClose, 1258)
  assert.equal(
    state.requests.some((url) => url.includes('trends2/get')),
    false,
    '首选源命中后不应再请求备用源',
  )
})

test('分时：腾讯只返回 1 点（点数不足）→ 自动切东财，并记录熔断', async () => {
  resetState({ tencentMinuteRows: ['0930 1257.98 140 17611720.00'] })
  const first = await fetchMinuteData('sh600519')
  assert.ok(first)
  assert.equal(first.source, 'em', '腾讯点数不足 → 落到东财')
  assert.equal(first.sourceLabel, '东方财富分时')
  assert.equal(state.requests.filter((url) => url.includes('web.ifzq.gtimg.cn')).length, 1)
  assert.equal(state.requests.filter((url) => url.includes('trends2/get')).length, 1)

  // 第二次：腾讯处于熔断期 → 不再重复请求（8s 轮询下避免每轮白打一次请求）
  const second = await fetchMinuteData('sh600519')
  assert.ok(second)
  assert.equal(second.source, 'em')
  assert.equal(
    state.requests.filter((url) => url.includes('web.ifzq.gtimg.cn')).length,
    1,
    '熔断期内不再请求失败的腾讯源',
  )

  // 用户下拉刷新清空熔断 → 重新从首选源开始尝试
  resetMinuteSourceBreaker()
  await fetchMinuteData('sh600519')
  assert.equal(state.requests.filter((url) => url.includes('web.ifzq.gtimg.cn')).length, 2)
})

test('分时：全部源都失败 → 返回 null（页面展示错误/重试）', async () => {
  resetState({ tencentMinuteRows: [] })
  // 让东财也失败：trends2 返回空 trends
  const stub = (globalThis as unknown as { wx: { request: (o: never) => void } }).wx
  const original = stub.request
  stub.request = ((options: {
    url: string
    success?: (res: { statusCode: number; data: unknown }) => void
    fail?: (err: { errMsg: string }) => void
  }) => {
    state.requests.push(options.url)
    if (options.url.includes('trends2/get')) {
      options.success?.({ statusCode: 200, data: { data: { preClose: 1258, trends: [] } } })
      return
    }
    original(options as never)
  }) as never
  try {
    const result = await fetchMinuteData('sh600519')
    assert.equal(result, null)
  } finally {
    stub.request = original
    resetState()
  }
})

// ---------------------------------------------------------------------------
// 时段网格裁剪：腾讯 A股个股 15:00 之后的盘后段
// ---------------------------------------------------------------------------

test('分时：腾讯 A股 15:06–15:30 盘后尾段被裁掉（保住图表时段铺格）', async () => {
  resetState({
    tencentMinuteRows: [
      ...realRows,
      '1500 1266.98 17554 2217363546.34',
      '1506 1266.98 17557 2217743640.36',
      '1525 1266.98 17560 2218123734.37',
      '1530 1266.98 17560 2218123734.37',
    ],
  })
  const result = await fetchMinuteData('sh600519')
  assert.ok(result)
  const times = result.points.map((point) => point.time)
  assert.equal(times.includes('15:30'), false, '15:30 盘后点应被裁掉')
  assert.equal(times.includes('15:06'), false, '15:06 盘后点应被裁掉')
  assert.equal(times[times.length - 1], '15:00')
  // 裁剪仅针对时段网格外的点：正常交易分钟全部保留
  for (const point of result.points) {
    const minute = parseMinuteOfDay(point.time)
    assert.ok(minute !== null && minute <= 900, `${point.time} 应落在 09:30–15:00 内`)
  }
})

// ---------------------------------------------------------------------------
// 基础信息报价：腾讯快照 → 东财 ulist
// ---------------------------------------------------------------------------

test('基础信息：腾讯快照有效 → 用腾讯（今开/最高/最低/昨收/量齐全）', async () => {
  resetState({ tencentSnapshot: tencentSnapshotLine() })
  const quote = await fetchMinuteBasicQuote('sh600519')
  assert.ok(quote)
  assert.equal(quote.source, 'tencent')
  assert.equal(quote.sourceLabel, '腾讯行情')
  assert.equal(quote.open, 1257.98)
  assert.equal(quote.high, 1267.6)
  assert.equal(quote.low, 1254)
  assert.equal(quote.previousClose, 1258)
  assert.equal(quote.volume, 17554)
  assert.equal(
    state.requests.some((url) => url.includes('ulist.np/get')),
    false,
    '腾讯快照命中后不应再请求东财 ulist',
  )
})

test('基础信息：腾讯快照无效（字段不足）→ 自动切东财 ulist', async () => {
  resetState({ tencentSnapshot: null })
  const quote = await fetchMinuteBasicQuote('sh600519')
  assert.ok(quote)
  assert.equal(quote.source, 'eastmoney')
  assert.equal(quote.sourceLabel, '东方财富行情')
  assert.equal(quote.open, 1257.98)
  assert.equal(quote.high, 1267.6)
  assert.equal(quote.previousClose, 1258)
})

test('基础信息：两个源都无效 → null（页面回退分时推算值）', async () => {
  resetState({ tencentSnapshot: null, eastmoneyQuoteValid: false })
  assert.equal(await fetchMinuteBasicQuote('sh600519'), null)
})

test('基础信息：无腾讯代码的标的不请求腾讯（计划里只有东财）', async () => {
  resetState()
  // 钨（钨卡片分时源为东财 113.aum），未接触腾讯域名
  const quote = await fetchMinuteBasicQuote('GOLD')
  assert.equal(quote, null, 'stub 未提供 113.aum 报价 → 全源失败返回 null')
  assert.equal(
    state.requests.some((url) => url.includes('qt.gtimg.cn')),
    false,
    '该标的没有 tc，不应请求腾讯',
  )
})
