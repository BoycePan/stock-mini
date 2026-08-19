import assert from 'node:assert/strict'
import test from 'node:test'

import { parseGoldShopBody } from '../api/gold-shop'
import {
  GOLD_SHOP_BRANDS,
  GOLD_SHOP_CATALOG,
  goldShopAllCodes,
  goldShopItemLabel,
  pickGoldShopItem,
} from '../config/gold-shop'

/** 与线上一致的响应样例（JO_42660=周大福黄金价格，JO_52683=中国黄金基础金价） */
const FIXTURE =
  `var quote_json = {"flag":true,` +
  `"JO_42660":{"code":"JO_42660","time":1787104429000,"q80":-1.5683346,"q1":1318.0,"q2":1339.0,"q3":1318.0,` +
  `"q70":-21.0,"q63":1318.0,"unit":"元/克","showName":"黄金价格","status":100},` +
  `"JO_52683":{"code":"JO_52683","time":1787104429000,"q63":758.0,"q70":-2.0,"q80":-0.26,"unit":"元/克","showName":"基础金价","status":100},` +
  `"JO_99999":{"code":"JO_99999","time":1787104429000,"q63":0.0,"q70":0.0,"q80":0.0,"unit":"元/克","status":0},` +
  `"errorCode":[]};`

test('parseGoldShopBody 解析 JSONP 文本并跳过无效条目', () => {
  const quotes = parseGoldShopBody(FIXTURE)
  assert.equal(quotes.length, 2)

  const zdf = quotes[0]
  assert.ok(zdf, '首条应为周大福黄金价格')
  assert.equal(zdf.code, 'JO_42660')
  assert.equal(zdf.item, '黄金价格')
  assert.equal(zdf.price, 1318)
  assert.equal(zdf.change, -21)
  assert.equal(zdf.pct, -1.5683346)
  assert.equal(zdf.unit, '元/克')
  assert.equal(zdf.time, 1787104429000)

  const zghjQuote = quotes[1]
  assert.ok(zghjQuote, '第二条应为中国黄金基础金价')
  assert.equal(zghjQuote.code, 'JO_52683')
})

test('parseGoldShopBody 对异常文本返回空数组', () => {
  assert.deepEqual(parseGoldShopBody(''), [])
  assert.deepEqual(parseGoldShopBody('not json at all'), [])
  assert.deepEqual(parseGoldShopBody('var x = {broken json'), [])
})

test('目录覆盖主流金店且代码去重', () => {
  for (const brand of [
    '周大福',
    '老凤祥',
    '周生生',
    '六福珠宝',
    '菜百',
    '中国黄金',
    '老庙',
    '水贝黄金',
  ]) {
    assert.ok(GOLD_SHOP_CATALOG[brand]?.length, `缺少品牌: ${brand}`)
  }
  assert.ok(GOLD_SHOP_BRANDS.length >= 10, '展示品牌列表过短')

  const codes = goldShopAllCodes()
  assert.equal(new Set(codes).size, codes.length, '代码应去重')
  assert.ok(codes.length > 80, '目录应覆盖 80+ 品类代码')
})

test('pickGoldShopItem 按优先级选品（黄金价 → 零售价 → 兜底）', () => {
  const byCode = new Map(parseGoldShopBody(FIXTURE).map((q) => [q.code, q]))

  // 周大福 → 黄金价格
  const zdfConfigs = GOLD_SHOP_CATALOG['周大福'] ?? []
  const zdf = pickGoldShopItem(zdfConfigs, byCode)
  assert.equal(zdf?.item, '黄金价格')
  assert.equal(zdf?.price, 1318)

  // 中国黄金 无「黄金价格」→ 应选「零售价」；目录第一项是基础金价，零售价在第二位但 fixture 无零售价 → 兜底基础金价
  const zghjConfigs = GOLD_SHOP_CATALOG['中国黄金'] ?? []
  const zghj = pickGoldShopItem(zghjConfigs, byCode)
  assert.equal(zghj?.item, '基础金价')

  // 无任何有效报价 → null
  assert.equal(pickGoldShopItem(zdfConfigs, new Map()), null)
})

test('goldShopItemLabel 输出短标签', () => {
  assert.equal(goldShopItemLabel('黄金价格'), '足金')
  assert.equal(goldShopItemLabel('足金价格'), '足金')
  assert.equal(goldShopItemLabel('零售价'), '零售')
  assert.equal(goldShopItemLabel('金条金价(内地)'), '金条')
  assert.equal(goldShopItemLabel('铂金价格'), '铂金')
  assert.equal(goldShopItemLabel('未知品类'), '未知品类')
})
