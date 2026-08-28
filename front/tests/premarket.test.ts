/**
 * 行业板块均值取数的纯函数测试（api/market.ts 行业板块三态路由的公共助手，
 * 见 utils/quote.ts averageBoardPcts 与 docs/美股盘前板块展示分析与改造方案.md 改动 5）。
 *
 * 仅覆盖无网络依赖的纯逻辑（averageBoardPcts）；
 * fetchUsProxyPremarketMap / fetchUsProxyChangeMap 依赖外部接口（wx.request），
 * 其数据链路由 docs/tabbar-api.md + 仓库既有 quote-parsers 测试覆盖。
 */
import assert from 'node:assert/strict'
import test from 'node:test'

import { averageBoardPcts } from '../utils/quote.ts'

test('averageBoardPcts：docs 四.2 示例（AI算力 命中 2 个 → +2.50%）', () => {
  // AI算力 proxies: NVDA/AMD/AVGO/MRVL/SMCI，盘前命中 NVDA +3.0、AMD +2.0，其余未命中
  const map: Record<string, number> = {
    '105.NVDA': 3,
    NVDA: 3,
    '105.AMD': 2,
    AMD: 2,
  }
  const pct = averageBoardPcts(['105.NVDA', '105.AMD', '105.AVGO', '105.MRVL', '105.SMCI'], map)
  assert.equal(pct, 2.5, '算术平均 (3.0 + 2.0) / 2 = 2.5，与文档示例 +2.50% 一致')
})

test('averageBoardPcts：完整 secid 缺失时回退裸代码查表', () => {
  assert.equal(averageBoardPcts(['105.NVDA'], { NVDA: 1.5 }), 1.5)
  assert.equal(averageBoardPcts(['105.NVDA'], { '105.NVDA': -0.8 }), -0.8)
})

test('averageBoardPcts：全部未命中返回 null（板块占位 --）', () => {
  assert.equal(averageBoardPcts(['105.NVDA', '105.AMD'], {}), null)
})

test('averageBoardPcts：非有限数值命中被剔除，剩余有效值参与平均', () => {
  const map: Record<string, number> = {
    '105.NVDA': 3,
    '105.AMD': Number.NaN,
    '105.AVGO': 1,
  }
  const pct = averageBoardPcts(['105.NVDA', '105.AMD', '105.AVGO'], map)
  assert.equal(pct, 2, '剔除 NaN 后 (3 + 1) / 2 = 2')
})

test('averageBoardPcts：空代理列表返回 null', () => {
  assert.equal(averageBoardPcts([], { '105.NVDA': 3 }), null)
})
