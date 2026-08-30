import type { AdConfig } from '../types/system'

/**
 * 广告位配置解析（components/ad-banner 使用）。
 *
 * 后端 app_config（cfg_type='display'）的 adConfig 分组下发全部广告位（docs/API.md 八），
 * 前端按 location 查找对应 unit-id，并校验 status 是否启用：
 * - 配置未就绪（首屏配置接口尚未返回，冷启动竞态）→ 空串（不渲染，不影响页面布局）；
 * - location 未配置 / status=false → 空串（不渲染）；
 * - 命中且启用 → 返回 unit-id 供 <ad-custom unit-id> 渲染。
 *
 * 纯函数便于单测（tests/ad-config.test.ts）；组件内通过 MobX 绑定读取
 * rootStore.system.configs.adConfig，配置到达时广告位即时出现。
 */
export function resolveAdUnitId(adConfig: AdConfig | undefined, location: string): string {
  const banner = adConfig?.bannerAd?.find((item) => item.location === location)
  return banner && banner.status ? banner['unit-id'] : ''
}
