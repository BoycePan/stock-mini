import assert from 'node:assert/strict'
import test from 'node:test'

import { calculatePercentChange } from '../utils/formatter.ts'

import {
  unwrapAnnouncementItems,
  unwrapNewsItems,
  unwrapSectorMemberCodes,
} from '../utils/api-normalizers.ts'

test('unwraps news API envelopes returned by the backend', () => {
  const items = unwrapNewsItems({
    code: '600519',
    count: 1,
    news: [{ title: '贵州茅台新闻', url: 'https://example.com', time: '2026-08-05 20:00' }],
  })

  assert.equal(items.length, 1)
  assert.equal(items[0]?.time, '2026-08-05 20:00')
})

test('unwraps announcement API envelopes', () => {
  const items = unwrapAnnouncementItems({
    code: '600519',
    page: 1,
    count: 1,
    items: [{ id: '1', title: '公告', url: 'https://example.com', time: '2026-08-05' }],
  })

  assert.deepEqual(items, [
    { id: '1', title: '公告', url: 'https://example.com', time: '2026-08-05' },
  ])
})

test('unwraps sector member codes instead of treating the response object as an array', () => {
  const codes = unwrapSectorMemberCodes({ cid: 300382, count: 2, stocks: ['600519', '000001'] })

  assert.deepEqual(codes, ['600519', '000001'])
})

test('calculates K-line changes from adjacent closes when the API omits pct_change', () => {
  assert.equal(calculatePercentChange(110, 100), 10)
  assert.equal(calculatePercentChange(110), null)
})
