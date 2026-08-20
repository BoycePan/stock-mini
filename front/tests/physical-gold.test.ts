import assert from 'node:assert/strict'
import test from 'node:test'

import { PHYSICAL_GOLD_CATALOG, physicalGoldCodes } from '../config/physical-gold'

test('实物黄金目录覆盖 SGE 核心品种且代码唯一', () => {
  const names = PHYSICAL_GOLD_CATALOG.map((item) => item.name)
  for (const expect of ['黄金9999', '黄金9995', '金条100g', '黄金T+D', '铂金9995', '白银T+D']) {
    assert.ok(names.includes(expect), `缺少品种: ${expect}`)
  }

  const codes = physicalGoldCodes()
  assert.equal(new Set(codes).size, codes.length, '代码应去重')
  assert.ok(codes.includes('JO_71'), '黄金9999 应使用 JO_71')
})

test('实物黄金目录每个品种都带价格区间校验', () => {
  for (const item of PHYSICAL_GOLD_CATALOG) {
    assert.ok(item.min < item.max, `${item.name} 区间非法`)
    assert.ok(item.code.startsWith('JO_'), `${item.name} 代码格式非法`)
  }
})
