/**
 * 行情面板内 Tab（如首页「行业板块」的 A股 / 美股）的选中投影。
 *
 * 数据层（api/market.ts → utils/quote-pages.ts）为每个 Tab 备好该市场的指标与展示元信息，
 * 并把「按时段规则判定的默认 Tab」写进 `section.activeTab`；本模块把**当前选中 Tab** 的
 * 指标 / 阶段胶囊 / 分时角标投影到分区字段上，使渲染层（components/section-card）、
 * 分享海报（utils/share-poster.ts）与卡片点击共用同一份口径。
 *
 * 纯函数、无 wx / store 依赖：选中规则由调用方以 `resolveTab` 注入
 * （页面层传 stores/market.store.ts 的 resolveSectionTab —— 用户手动选择优先，
 * 时段口径翻转后自动失效），因此可直接在 Node 测试中复用。
 */

import type { MarketSection } from '../types/market'

/**
 * 把选中 Tab 投影到分区字段：
 * - `metrics` / `marketStatus` / `marketTone` / `minuteCorner` 改为选中 Tab 的值；
 * - `activeTab` 写回最终选中键（可能被用户手动选择覆盖）；
 * - `tabs` 只保留渲染 Tab 条所需的字段：key / label 与**该 Tab 自己的**盘面状态短文案
 *   （每个 Tab 上直接显示所属市场此刻在盘中/休市，两个市场状态一眼可比），
 *   各 Tab 的整份指标不再随 setData 重复序列化。
 *
 * 无 Tab 的面板原样返回（不改动任何字段）。
 *
 * @param section 数据层给出的分区（含双 Tab 数据）
 * @param resolveTab 选中键解析：(分区 id, 时段默认键) => 最终选中键
 */
export function projectSectionTab(
  section: MarketSection,
  resolveTab: (sectionId: string, sessionDefault: string) => string,
): MarketSection {
  const tabs = section.tabs ?? []
  if (!tabs.length) return section

  const sessionDefault = section.activeTab ?? tabs[0]?.key ?? ''
  const activeKey = resolveTab(section.id, sessionDefault)
  const picked = tabs.find((tab) => tab.key === activeKey) ?? tabs[0]
  if (!picked) return section

  return {
    ...section,
    metrics: picked.metrics ?? section.metrics,
    marketStatus: picked.marketStatus,
    marketTone: picked.marketTone,
    minuteCorner: picked.minuteCorner,
    activeTab: picked.key,
    tabs: tabs.map((tab) => ({
      key: tab.key,
      label: tab.label,
      marketStatusShort: tab.marketStatusShort,
      marketTone: tab.marketTone,
    })),
  }
}
