/**
 * 页面「这次 onShow 是怎么来的」判定（插屏广告等「按显示时机触发」的功能共用）。
 *
 * 小程序页面的 onShow 会被多种原因触发，只凭 onShow 无法区分，本模块把它们收敛成 4 种原因：
 * - `enter`：页面 **onLoad 之后的首次显示**——冷启动首页、首次切到某个 tab、navigateTo 进子页面；
 * - `tab-switch`：用户点了自定义 tabBar 切到该 tab（`custom-tab-bar/index.ts` 里 `markTabSwitch`）；
 * - `app-foreground`：App 从后台回到前台（`wx.onAppShow` 先于页面 onShow 触发，由插屏模块打标）；
 * - `return`：从子页面返回（navigateBack）等以上都不是的「重新显示」。
 *
 * 判定依据两部分：
 * 1. **实例是否已显示过**（`WeakSet`，随实例回收不泄漏）：首次显示必然紧跟 onLoad，即 `enter`；
 *    之后再显示只可能是切 tab / 回前台 / 从子页面返回，需要靠意图标记区分；
 * 2. **意图标记**：切 tab（tabBar 点击处打标，带目标 key）与回前台（App.onShow 打标）——
 *    两者都是「导航发生前」打标、**判定时一次性消费**（无论本次判定用不用得上），
 *    并有 TTL 兜底，避免陈旧标记把「从子页面返回」误判成可展示的时机。
 *
 * 与插屏的对应关系（见 utils/interstitial-ad.ts 闸门 0）：`return` 不展示，
 * 其余三种原因允许展示；`app-foreground` 是否展示由 config 的 `showOnAppForeground` 决定。
 */

export type PageShowReason = 'enter' | 'tab-switch' | 'app-foreground' | 'return'

/**
 * 意图标记有效期（ms）：wx.switchTab 到目标页 onShow、App.onShow 到页面 onShow 都是毫秒级，
 * 留 2s 余量足够，同时把「标记残留导致误判」的窗口压到可忽略。
 */
export const MARK_TTL_MS = 2000

/** 已显示过的页面实例（首次显示 = onLoad 后第一次 onShow；实例销毁后自动回收） */
const shownPages = new WeakSet<object>()

/** 切 tab 意图：目标 tab key + 打标时间 */
let tabSwitchMark: { key: string; at: number } | null = null

/** 回前台意图：打标时间（0 = 无标记） */
let appForegroundAt = 0

/**
 * 标记「用户点了 tabBar，正切到 key 页」（custom-tab-bar 的 onTab 调用）。
 * `key` 与页面标识同名（插屏 location 对 tab 页即 tab key），判定时要求两者一致，
 * 防止一个 tab 的标记被别的页面消费掉。
 */
export function markTabSwitch(key: string, now: number = Date.now()): void {
  tabSwitchMark = { key, at: now }
}

/** 标记「App 从后台回到前台」（插屏模块的 wx.onAppShow 监听调用） */
export function markAppForeground(now: number = Date.now()): void {
  appForegroundAt = now
}

/**
 * 判定本次页面显示的原因；**每个页面实例的首次调用返回 'enter'**。
 * 两个意图标记在此一次性消费（不论最终判定成哪种原因），保证不会影响下一次显示。
 *
 * @param target 页面标识（插屏 location —— tab 页与 tab key 同名，用于核对切 tab 标记）
 * @param page 页面实例（调用处传 `this`）
 * @param now 判定时刻（默认当前时间，便于测试固定）
 */
export function resolvePageShowReason(
  target: string,
  page: object,
  now: number = Date.now(),
): PageShowReason {
  const tabMark = tabSwitchMark && now - tabSwitchMark.at <= MARK_TTL_MS ? tabSwitchMark : null
  tabSwitchMark = null
  const fromForeground = appForegroundAt > 0 && now - appForegroundAt <= MARK_TTL_MS
  appForegroundAt = 0

  if (!shownPages.has(page)) {
    shownPages.add(page)
    return 'enter'
  }
  if (tabMark && tabMark.key === target) return 'tab-switch'
  if (fromForeground) return 'app-foreground'
  return 'return'
}

/** 测试辅助：清空两个意图标记（实例标记是 WeakSet、无法也不需清空，测试用全新实例即可） */
export function __resetPageShowForTest(): void {
  tabSwitchMark = null
  appForegroundAt = 0
}
