import assert from 'node:assert/strict'
import test from 'node:test'

import { rawBytesToString } from '../api/external.ts'
import { parseSinaText, sinaGbPremarketFields, sinaGbProxyPct } from '../utils/quote-parser.ts'

// ---------------------------------------------------------------------------
// rawBytesToString：将原始字节逐字节还原（Latin-1 保留），用于新浪/腾讯等 GBK 文本行情。
// 微信 wx.request 默认按 UTF-8 解码响应，遇到 GBK 字节在真机会直接失败
// （request:fail response data convert to UTF8 fail），故走 responseType:'arraybuffer' 拿原始字节。
// ---------------------------------------------------------------------------

test('rawBytesToString：逐字节保留，GBK 中文名不丢字节、ASCII/数字结构不变', () => {
  // "英伟达" 的 GBK 字节 = d3 a2 ce b0 b4 ef；其后是 ASCII 数字字段
  const bytes = new Uint8Array([
    0xd3, 0xa2, 0xce, 0xb0, 0xb4, 0xef, 0x2c, 0x32, 0x31, 0x33, 0x2e, 0x30, 0x35, 0x30, 0x30,
  ])
  const text = rawBytesToString(bytes.buffer.slice(0))
  // GBK 中文名按字节保留为 Latin-1（每个字节 → 一个 0x00-0xFF 码位），数值部分保持 ASCII
  assert.equal(text.charCodeAt(0), 0xd3)
  assert.equal(text.charCodeAt(1), 0xa2)
  const expected = `${String.fromCharCode(0xd3, 0xa2, 0xce, 0xb0, 0xb4, 0xef)},213.0500`
  assert.equal(text, expected)
})

test('rawBytesToString：空缓冲区返回空串', () => {
  assert.equal(rawBytesToString(new ArrayBuffer(0)), '')
})

// ---------------------------------------------------------------------------
// 集成：模拟新浪 gb_ 实际返回（GBK 中文名 + 36 字段布局），验证盘前字段取数不受影响。
// ---------------------------------------------------------------------------

test('新浪 gb_ GBK 字节 → parseSinaText → 盘前字段取数', () => {
  // 构造一段字节：var hq_str_gb_nvda="<GBK 名>,<fields...>";
  const fields = [
    // [0] 名称（GBK 字节，由调用方拼接）
    '',
    '213.0500', // [1] 现价
    '2.19', // [2] 涨跌幅%（gb 代理股消费方）
    '2026-08-26 18:15:22', // [3] 时间
    '4.5700',
    '211.0250',
    '214.7300',
    '210.1100',
    '236.2900',
    '163.7900',
    '122308928',
    '102575805',
    '5160956881713',
    '6.57',
    '32.43000',
    '0.00',
    '0.00',
    '0.00',
    '0.00',
    '24224158093',
    '69',
    '213.6877', // [21] 盘前价
    '0.30', // [22] 盘前涨跌幅%
    '0.64', // [23] 盘前涨跌额
    'Aug 26 06:15AM EDT', // [24] 盘前时间
  ]

  // 拼字节：前缀 + GBK 名（英伟达）+ 逗号 + 其余字段
  const nameGbk = [0xd3, 0xa2, 0xce, 0xb0, 0xb4, 0xef] // 英伟达
  const joinField = (i: number): Uint8Array => {
    const str = fields[i] ?? ''
    return new Uint8Array(str.split('').map((ch) => ch.charCodeAt(0)))
  }
  const prefix = 'var hq_str_gb_nvda="'
  const prefixBytes = new Uint8Array(prefix.split('').map((ch) => ch.charCodeAt(0)))

  const parts: Uint8Array[] = [prefixBytes, new Uint8Array(nameGbk)]
  // 追加 ",213.0500,..."（fields[1] 起以逗号分隔）
  parts.push(new Uint8Array([0x2c])) // ','
  for (let i = 1; i < fields.length; i++) {
    if (i > 1) parts.push(new Uint8Array([0x2c])) // ','
    parts.push(joinField(i))
  }
  parts.push(new Uint8Array([0x22, 0x3b])) // '";'

  const total = parts.reduce((sum, p) => sum + p.length, 0)
  const buffer = new Uint8Array(total)
  let offset = 0
  for (const part of parts) {
    buffer.set(part, offset)
    offset += part.length
  }

  const text = rawBytesToString(buffer.buffer.slice(0))
  const map = parseSinaText(text, ['gb_nvda'])
  const row = map.get('gb_nvda') ?? []
  assert.equal(row.length, fields.length)
  // 中文名按字节保留（Latin-1），数值字段不受影响
  assert.equal(sinaGbProxyPct(row), 2.19)
  const pre = sinaGbPremarketFields(row)
  assert.equal(pre.price, 213.6877)
  assert.equal(pre.pct, 0.3)
  assert.equal(pre.chg, 0.64)
  assert.equal(pre.time, 'Aug 26 06:15AM EDT')
})
