import type { InterstitialAdConfig } from '../config/interstitial-ad'
import type { AdConfig } from '../types/system'

/**
 * 广告配置解析（components/ad-banner 原生模板广告 + utils/interstitial-ad 插屏广告共用）。
 *
 * 后端 app_config（cfg_type='display'）的 adConfig 分组下发全部广告配置（docs/API.md 八）：
 * - `bannerAd`：原生模板广告位（<ad-custom>），前端按 location 查找 unit-id 渲染；
 * - `interstitialAd`：插屏广告位（createInterstitialAd），前端按 location 解析 unit-id；
 * - `interstitialConfig`：插屏行为参数（总开关 / 时机 / 频控 / 重试），逐项覆盖本地默认值。
 * 广告位均校验 status 是否启用：
 * - 配置未就绪（首屏配置接口尚未返回，冷启动竞态）→ 空串（不展示，不影响页面布局）；
 * - location 未配置 / status=false → 空串（不展示）；
 * - 命中且启用 → 返回 unit-id。
 *
 * 纯函数便于单测（tests/ad-config.test.ts）；消费方通过 MobX 绑定读取
 * rootStore.system.configs.adConfig，配置到达时广告位 / 参数即时生效。
 */
export function resolveAdUnitId(adConfig: AdConfig | undefined, location: string): string {
  const banner = adConfig?.bannerAd?.find((item) => item.location === location)
  return banner && banner.status ? banner['unit-id'] : ''
}

/**
 * 插屏广告位解析（utils/interstitial-ad.ts 使用）：按 location 从
 * `adConfig.interstitialAd` 查 unit-id，并校验 status。
 *
 * 与原生模板广告位的差异（需求口径）：插屏**没有全局兜底广告位**——
 * - 某个 location 未配置 / status=false → 空串（该位置的页面不弹插屏）；
 * - 配置未就绪（冷启动首屏竞态）→ 空串；调度器会挂起本次触发等待配置到达
 *   （见 utils/interstitial-ad.ts scheduleConfigWait），超时或配置始终没有该 location 则不展示。
 *
 * 纯函数便于单测（tests/ad-config.test.ts）；远端配置（后台 ad_config 调整 status）
 * 即时生效，无需发版。
 */
export function resolveInterstitialUnitId(
  adConfig: AdConfig | undefined,
  location: string,
): string {
  const interstitial = adConfig?.interstitialAd?.find((item) => item.location === location)
  return interstitial && interstitial.status ? interstitial['unit-id'] : ''
}

/** 可被远端覆盖的布尔参数（adConfig.interstitialConfig） */
const INTERSTITIAL_BOOL_KEYS = ['enabled', 'showOnAppForeground'] as const

/** 可被远端覆盖的数值参数：值 = 允许的最小值（远端小于该值的取值视为非法，回落默认值） */
const INTERSTITIAL_NUMBER_KEYS: Record<
  Exclude<keyof InterstitialAdConfig, (typeof INTERSTITIAL_BOOL_KEYS)[number]>,
  number
> = {
  minIntervalMs: 0,
  newUserWindowDays: 0,
  newUserDailyCap: 0,
  dailyCap: 0,
  maxAttempts: 1, // 完整流程至少尝试 1 次（含首次）
  retryIntervalMs: 0,
  loadTimeoutMs: 0,
  configWaitTimeoutMs: 0,
}

/**
 * 插屏行为参数解析（utils/interstitial-ad.ts 每次判定时调用）：
 * 以本地默认值 `defaults`（config/interstitial-ad.ts INTERSTITIAL_AD_CONFIG）为底，
 * 用远端 `adConfig.interstitialConfig` **逐项**覆盖。
 *
 * 容错口径（后台配置随时可改，写错不能把插屏链路搞挂）：
 * - 远端缺该项 / 不是预期类型（字符串、null…）/ 数值为 NaN、Infinity、负数
 *   （`maxAttempts` 小于 1）→ **保留本地默认值**（不会退化成 0 造成不限频 / 狂重试）；
 * - 布尔项只接受 `true` / `false`（如 `"false"` 字符串按「未配置」处理）；
 * - 本地默认值来自发版时的 config/interstitial-ad.ts，故后台只需配要覆盖的项。
 *
 * 纯函数便于单测（tests/ad-config.test.ts resolveInterstitialSettings 用例）。
 */
export function resolveInterstitialSettings(
  remote: AdConfig['interstitialConfig'],
  defaults: InterstitialAdConfig,
): InterstitialAdConfig {
  const merged: InterstitialAdConfig = { ...defaults }
  if (!remote || typeof remote !== 'object') return merged

  for (const key of INTERSTITIAL_BOOL_KEYS) {
    const value = remote[key]
    if (typeof value === 'boolean') merged[key] = value
  }
  for (const [key, min] of Object.entries(INTERSTITIAL_NUMBER_KEYS) as Array<
    [keyof typeof INTERSTITIAL_NUMBER_KEYS, number]
  >) {
    const value = remote[key]
    if (typeof value === 'number' && Number.isFinite(value) && value >= min) merged[key] = value
  }
  return merged
}
