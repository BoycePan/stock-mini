import assert from 'node:assert/strict'
import test from 'node:test'

import type { GlobalAsset, GlobalIndex, GlobalSector } from '../types/global.ts'
import {
  buildAsiaPage,
  buildGlobalPage,
  buildMetalsPage,
  marketName,
} from '../utils/global-market.ts'

const index = (
  code: string,
  name: string,
  market: string,
  price: number | null,
  isTrading = true,
): GlobalIndex => ({
  code,
  name,
  market,
  price,
  pctChange: 1.5,
  updatedAt: '2026-08-12T10:00:00',
  tradingHours: '21:30-04:00',
  isTrading,
})

const sector = (code: string, name: string, board: 'industry' | 'theme'): GlobalSector => ({
  code,
  name,
  market: 'us',
  board,
  price: 100,
  pctChange: -0.5,
  updatedAt: '2026-08-12T10:00:00',
  tradingHours: '21:30-04:00',
  isTrading: true,
})

const asset = (code: string, name: string, board: string): GlobalAsset => ({
  code,
  name,
  type: 'commodity',
  market: 'global',
  board,
  price: 50,
  pctChange: 2,
  updatedAt: '2026-08-12T10:00:00',
  tradingHours: '06:00-05:00',
  isTrading: true,
})

test('builds the global page with index/economy/industry/theme sections', () => {
  const page = buildGlobalPage(
    [index('^GSPC', '标普500', 'us', 7753.11), index('000001.SS', '上证综指', 'cn', 3421.5)],
    [sector('XLK', '科技', 'industry'), sector('BOTZ', '机器人AI', 'theme')],
    [asset('GC=F', '黄金', '贵金属'), asset('CL=F', 'WTI原油', '能源')],
  )

  assert.equal(page.source, 'backend')
  assert.equal(page.statusTone, 'active')
  assert.deepEqual(
    page.sections.map((section) => section.title),
    ['全球指数', '全球经济数据', '美股行业', '美股主题'],
  )
  assert.equal(page.sections[0]?.metrics.length, 1)
  assert.equal(page.sections[0]?.metrics[0]?.value, '7753.11')
  assert.equal(page.sections[1]?.metrics.length, 2)
  assert.equal(page.sections[3]?.metrics[0]?.name, '机器人AI')
})

test('uses empty value and rest tone when the market is closed', () => {
  const page = buildGlobalPage([index('^GSPC', '标普500', 'us', null, false)], [], [])

  assert.equal(page.statusTone, 'rest')
  assert.equal(page.sections[0]?.metrics[0]?.value, '')
})

test('groups Asia indices by market', () => {
  const page = buildAsiaPage([
    index('^KS11', '韩国KOSPI', 'kr', 3000),
    index('^N225', '日经225', 'jp', 40000),
    index('^HSI', '恒生指数', 'hk', 20000),
  ])

  assert.deepEqual(
    page.sections.map((section) => section.title),
    ['韩国市场', '日本市场', '香港市场'],
  )
  assert.equal(page.sections[0]?.metrics[0]?.name, '韩国KOSPI')
  assert.equal(marketName('kr'), '韩国')
  assert.equal(marketName('unknown-market'), 'UNKNOWN-MARKET')
})

test('groups metals page by commodity board', () => {
  const page = buildMetalsPage([
    asset('GC=F', '黄金', '贵金属'),
    asset('SI=F', '白银', '贵金属'),
    asset('HG=F', '铜', '有色金属'),
    asset('TIO=F', '铁矿石', '黑色金属'),
    asset('CL=F', 'WTI原油', '能源'),
    asset('ZC=F', '玉米', '农产品'),
  ])

  assert.deepEqual(
    page.sections.map((section) => section.title),
    ['贵金属', '工业金属', '能源'],
  )
  assert.equal(page.sections[0]?.metrics.length, 2)
  assert.equal(page.sections[1]?.metrics.length, 2)
  assert.equal(page.sections[1]?.metrics[0]?.name, '铜')
})
