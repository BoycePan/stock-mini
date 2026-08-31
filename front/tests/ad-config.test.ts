import assert from 'node:assert/strict'
import test from 'node:test'

import { resolveAdUnitId } from '../utils/ad-config.ts'
import type { AdConfig } from '../types/system.ts'

/** 与后端 app_config adConfig 分组同构的样例数据 */
const adConfig: AdConfig = {
  bannerAd: [
    { 'unit-id': 'adunit-home', location: 'homeTop', status: true },
    { 'unit-id': 'adunit-asia', location: 'asiaTop', status: true },
    { 'unit-id': 'adunit-metals', location: 'matalsTop', status: false },
    { 'unit-id': 'adunit-finance', location: 'finance', status: true },
  ],
}

test('按 location 命中启用中的广告位，返回对应 unit-id', () => {
  assert.equal(resolveAdUnitId(adConfig, 'homeTop'), 'adunit-home')
  assert.equal(resolveAdUnitId(adConfig, 'asiaTop'), 'adunit-asia')
  assert.equal(resolveAdUnitId(adConfig, 'finance'), 'adunit-finance')
})

test('status=false 的广告位不返回 unit-id（不展示）', () => {
  assert.equal(resolveAdUnitId(adConfig, 'matalsTop'), '')
})

test('未配置的 location 返回空串（不展示）', () => {
  assert.equal(resolveAdUnitId(adConfig, 'unknown-location'), '')
  assert.equal(resolveAdUnitId(adConfig, 'minute-detail'), '')
})

test('配置未就绪（冷启动首屏竞态 / 接口未返回）：返回空串，不影响页面布局', () => {
  assert.equal(resolveAdUnitId(undefined, 'homeTop'), '')
  assert.equal(resolveAdUnitId({}, 'homeTop'), '')
  assert.equal(resolveAdUnitId({ bannerAd: [] }, 'homeTop'), '')
})

test('bannerAd 缺省 / 条目字段不完整时安全返回空串', () => {
  assert.equal(resolveAdUnitId({ bannerAd: undefined }, 'homeTop'), '')
  // 类型上 unit-id / status 必填，这里模拟后台异常数据（缺 status 按未启用处理）
  const malformed = { bannerAd: [{ 'unit-id': 'adunit-x', location: 'homeTop' }] } as AdConfig
  assert.equal(resolveAdUnitId(malformed, 'homeTop'), '')
})
