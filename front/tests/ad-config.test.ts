import assert from 'node:assert/strict'
import test from 'node:test'

import {
  resolveAdUnitId,
  resolveInterstitialSettings,
  resolveInterstitialUnitId,
} from '../utils/ad-config.ts'
import { INTERSTITIAL_AD_CONFIG } from '../config/interstitial-ad.ts'
import type { AdConfig } from '../types/system.ts'

/** 与后端 app_config adConfig 分组同构的样例数据（bannerAd 原生模板 + interstitialAd 插屏） */
const adConfig: AdConfig = {
  bannerAd: [
    { 'unit-id': 'adunit-home', location: 'homeTop', status: true },
    { 'unit-id': 'adunit-asia', location: 'asiaTop', status: true },
    { 'unit-id': 'adunit-metals', location: 'matalsTop', status: false },
    { 'unit-id': 'adunit-finance', location: 'finance', status: true },
  ],
  interstitialAd: [
    { 'unit-id': 'adunit-interstitial-global', location: 'global', status: true },
    { 'unit-id': 'adunit-interstitial-asia', location: 'asia', status: true },
    { 'unit-id': 'adunit-interstitial-off', location: 'metals', status: false },
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

// ---------------------------------------------------------------------------
// 插屏广告位（adConfig.interstitialAd）：按 location 解析，**没有全局兜底**
// ---------------------------------------------------------------------------

test('插屏：按 location 命中启用中的广告位，返回对应 unit-id', () => {
  assert.equal(resolveInterstitialUnitId(adConfig, 'global'), 'adunit-interstitial-global')
  assert.equal(resolveInterstitialUnitId(adConfig, 'asia'), 'adunit-interstitial-asia')
})

test('插屏：status=false 不返回 unit-id（该位置不展示）', () => {
  assert.equal(resolveInterstitialUnitId(adConfig, 'metals'), '')
})

test('插屏：远端未配置该 location 返回空串（未配置就不展示，无本地兜底）', () => {
  assert.equal(resolveInterstitialUnitId(adConfig, 'news'), '')
  assert.equal(resolveInterstitialUnitId(adConfig, 'news-detail'), '')
  assert.equal(resolveInterstitialUnitId(adConfig, 'unknown-location'), '')
})

test('插屏：配置未就绪 / 缺 interstitialAd 时返回空串', () => {
  assert.equal(resolveInterstitialUnitId(undefined, 'global'), '')
  assert.equal(resolveInterstitialUnitId({}, 'global'), '')
  assert.equal(resolveInterstitialUnitId({ interstitialAd: [] }, 'global'), '')
  assert.equal(resolveInterstitialUnitId({ bannerAd: adConfig.bannerAd }, 'global'), '')
})

test('插屏：条目字段不完整时安全返回空串（缺 status 按未启用处理）', () => {
  const malformed = {
    interstitialAd: [{ 'unit-id': 'adunit-x', location: 'global' }],
  } as AdConfig
  assert.equal(resolveInterstitialUnitId(malformed, 'global'), '')
})

// ---------------------------------------------------------------------------
// 插屏行为参数（adConfig.interstitialConfig）：逐项覆盖本地默认值，非法值回落默认
// ---------------------------------------------------------------------------

test('插屏参数：远端未配置（undefined / 空对象）时全部沿用本地默认值', () => {
  assert.deepEqual(resolveInterstitialSettings(undefined, INTERSTITIAL_AD_CONFIG), {
    ...INTERSTITIAL_AD_CONFIG,
  })
  assert.deepEqual(resolveInterstitialSettings({}, INTERSTITIAL_AD_CONFIG), {
    ...INTERSTITIAL_AD_CONFIG,
  })
})

test('插屏参数：远端只配的项被覆盖，其余仍为默认值', () => {
  const resolved = resolveInterstitialSettings(
    { enabled: false, minIntervalMs: 30000, dailyCap: 5, showOnAppForeground: false },
    INTERSTITIAL_AD_CONFIG,
  )
  assert.equal(resolved.enabled, false)
  assert.equal(resolved.minIntervalMs, 30000)
  assert.equal(resolved.dailyCap, 5)
  assert.equal(resolved.showOnAppForeground, false)
  // 未配置的项沿用默认值
  assert.equal(resolved.maxAttempts, INTERSTITIAL_AD_CONFIG.maxAttempts)
  assert.equal(resolved.retryIntervalMs, INTERSTITIAL_AD_CONFIG.retryIntervalMs)
  assert.equal(resolved.loadTimeoutMs, INTERSTITIAL_AD_CONFIG.loadTimeoutMs)
  assert.equal(resolved.newUserDailyCap, INTERSTITIAL_AD_CONFIG.newUserDailyCap)
  assert.equal(resolved.newUserWindowDays, INTERSTITIAL_AD_CONFIG.newUserWindowDays)
})

test('插屏参数：0 是合法取值（0 间隔 / 0 次上限），不被当成「未配置」', () => {
  const resolved = resolveInterstitialSettings(
    { minIntervalMs: 0, retryIntervalMs: 0, newUserDailyCap: 0, dailyCap: 0, loadTimeoutMs: 0 },
    INTERSTITIAL_AD_CONFIG,
  )
  assert.equal(resolved.minIntervalMs, 0)
  assert.equal(resolved.retryIntervalMs, 0)
  assert.equal(resolved.newUserDailyCap, 0)
  assert.equal(resolved.dailyCap, 0)
  assert.equal(resolved.loadTimeoutMs, 0)
})

test('插屏参数：类型不合法 / 非有限数 / 越界值一律回落本地默认值', () => {
  const malformed = {
    enabled: 'false', // 字符串不是布尔
    showOnAppForeground: null,
    minIntervalMs: '15000',
    newUserWindowDays: NaN,
    newUserDailyCap: -1,
    dailyCap: Number.POSITIVE_INFINITY,
    maxAttempts: 0, // 完整流程至少要尝试 1 次
    retryIntervalMs: -100,
    loadTimeoutMs: 0,
    configWaitTimeoutMs: -1,
  } as unknown as AdConfig['interstitialConfig']
  const resolved = resolveInterstitialSettings(malformed, INTERSTITIAL_AD_CONFIG)

  assert.deepEqual(resolved, { ...INTERSTITIAL_AD_CONFIG, loadTimeoutMs: 0 })
})

test('插屏参数：不改动传入的默认值对象（纯函数，无副作用）', () => {
  const defaults = { ...INTERSTITIAL_AD_CONFIG }
  resolveInterstitialSettings({ enabled: false, dailyCap: 9 }, defaults)
  assert.deepEqual(defaults, INTERSTITIAL_AD_CONFIG)
})
