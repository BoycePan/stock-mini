import type { Notice, NoticeConfig, PopupNotice } from '../types/system'
import { isVersionGte, getAppVersion, getAppEnvVersion } from './version'

/**
 * 弹窗公告展示状态（wx 本地缓存）：首次展示日期 + 最近一次展示日期（YYYY-MM-DD）。
 */
export interface PopupNoticeState {
  firstShownDate: string
  lastShownDate: string
}

/** 展示状态缓存读写抽象（默认走 wx storage，测试可注入内存实现） */
export interface PopupNoticeStorage {
  get(key: string): unknown
  set(key: string, value: PopupNoticeState): void
}

/** 弹窗命中后返回的展示内容（title / buttonText 未配置时为空串，由组件兜底） */
export interface PopupNoticeView {
  /** 弹窗标题（未配置为空串） */
  title: string
  /** 公告正文（HTML，rich-text 渲染） */
  content: string
  /** 跳转路径（空 = 不跳转） */
  path: string
  /** 底部主按钮文案（未配置为空串） */
  buttonText: string
}

/** 默认存储：wx 本地缓存 */
const wxStorage: PopupNoticeStorage = {
  get(key: string) {
    return wx.getStorageSync(key)
  },
  set(key: string, value: PopupNoticeState) {
    wx.setStorageSync(key, value)
  },
}

/** 弹窗状态缓存键前缀（按公告 id 生成，见 resolveHomePopupNotice 的 storageKey） */
const STATE_KEY_PREFIX = 'popup_notice_state_'

/**
 * 是否为可用的 YYYY-MM-DD 日期串：格式必须匹配，且必须是**真实存在**的日历日期。
 *
 * 不能只依赖 Date.parse：V8 对「月内溢出日」不做校验而是归一化——
 * `Date.parse('2026-02-31T00:00:00')` 返回的是 3 月 3 日（不是 NaN），只有
 * `2026-13-01`（月份溢出）/ `garbage` / `2026/08/30`（分隔符不合法）才返回 NaN。
 * 因此这里额外做一次回环比对（构造 Date 后校验年月日字段未被归一化），
 * 把 2026-02-31 / 2026-13-01 / 2026-8-1 这类值判为不可用。
 *
 * 回环用 UTC 构造：与设备时区、DST 无关（个别时区存在被 DST 整体跳过的日期，
 * 本地构造会把它误判为非法，UTC 不受影响）。
 */
function isDateString(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const matched = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!matched) return false
  const year = Number(matched[1])
  const month = Number(matched[2])
  const day = Number(matched[3])
  const date = new Date(Date.UTC(year, month - 1, day))
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  )
}

/**
 * 非法 / 损坏的缓存状态视为「从未展示」，重新走首次展示逻辑。
 *
 * 必须校验日期本身可用，不能只校验 typeof === 'string'：dayDiff 在 Date.parse 失败时
 * 返回 NaN，而 `NaN >= notice.count` 恒为 false → count 天到期规则静默失效，
 * 公告变成每天无限弹（如缓存被写成 {firstShownDate:'garbage', lastShownDate:'2026-08-29'}）。
 * 判为损坏后按「从未展示」处理会立即展示一次并把状态重写为合法日期，实现自愈。
 */
function isValidState(state: unknown): state is PopupNoticeState {
  const candidate = state as PopupNoticeState | null | undefined
  return (
    !!candidate && isDateString(candidate.firstShownDate) && isDateString(candidate.lastShownDate)
  )
}

/**
 * 清理其它公告遗留的展示状态键（只保留当前公告的键，尽力而为、失败不影响展示）。
 *
 * 为什么：storageKey 按公告 id 生成（`popup_notice_state_{id}`），换一条公告就会新增一个
 * 永久键，全仓只写不清会长期缓慢累积（wx storage 有容量上限，遍历成本也随键数增长）。
 * 只在命中展示、真正要写状态时顺带清理一次；且只在当前键本身就是「按 id 的键」时清理——
 * 用默认键（popup_notice_state，非按 id）的调用方不动别人的 id 键，避免误删。
 */
function pruneStaleStateKeys(currentKey: string): void {
  if (!currentKey.startsWith(STATE_KEY_PREFIX)) return
  try {
    for (const key of wx.getStorageInfoSync().keys) {
      if (key !== currentKey && key.startsWith(STATE_KEY_PREFIX)) wx.removeStorageSync(key)
    }
  } catch {
    // 存储信息不可用：跳过清理，不影响本次展示逻辑
  }
}

/**
 * 本地日期字符串 YYYY-MM-DD（默认今天，可传固定日期便于测试）。
 */
export function todayDateString(date = new Date()): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/**
 * 两个 YYYY-MM-DD 日期相差的天数（to - from）。
 */
export function dayDiff(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00`)
  const b = Date.parse(`${to}T00:00:00`)
  return Math.round((b - a) / 86400000)
}

/**
 * 判断弹窗公告今天是否应展示，并返回展示后的最新缓存状态。
 *
 * 规则（count = 展示几天，一天展示一次）：
 * - 从未展示：展示，记 firstShownDate = lastShownDate = 今天；
 * - 今天已展示过（lastShownDate === 今天）：不展示；
 * - 距首次展示已满 count 天（今天 - firstShownDate >= count）：活动结束，不再展示；
 * - 其余（count 天内、今天未展示）：展示，lastShownDate 更新为今天。
 *
 * 纯函数：缓存状态与日期由调用方传入（页面负责 wx.getStorageSync / setStorageSync），
 * 便于单测。
 */
export function shouldShowPopupNotice(
  notice: PopupNotice,
  today: string,
  state: unknown,
): { show: boolean; state: PopupNoticeState } {
  if (!isValidState(state)) {
    const next: PopupNoticeState = { firstShownDate: today, lastShownDate: today }
    return { show: true, state: next }
  }
  if (state.lastShownDate === today) return { show: false, state }
  if (dayDiff(state.firstShownDate, today) >= notice.count) return { show: false, state }
  return { show: true, state: { firstShownDate: state.firstShownDate, lastShownDate: today } }
}

/**
 * envWhitelist 是否放行当前运行环境：缺省 / 空数组 / 非法值 = 不限；
 * 非空数组时当前环境（getAppEnvVersion，develop / trial / release）必须在列表内。
 */
function envAllowed(envWhitelist: unknown): boolean {
  if (!Array.isArray(envWhitelist) || envWhitelist.length === 0) return true
  return envWhitelist.some((env) => env === getAppEnvVersion())
}

/**
 * 弹窗公告通用调度：一次调用完成「minVersion 校验 + envWhitelist 环境白名单 + count 天每日一次」判断，
 * 命中时记录展示状态并返回展示内容，未命中返回 null。
 *
 * 调用方（页面 / 组件）拿到非空结果后直接渲染即可，无需关心版本与频率规则：
 * ```ts
 * const shown = tryShowPopupNotice(popup, 'popup_notice_state_6')
 * if (shown) this.setData({ visible: true, ...shown })
 * ```
 * storage 可注入（默认 wx 本地缓存），便于单测。
 */
export function tryShowPopupNotice(
  notice: PopupNotice | null | undefined,
  storageKey: string,
  storage: PopupNoticeStorage = wxStorage,
  now = new Date(),
): PopupNoticeView | null {
  if (!notice || !notice.content) return null
  if (!isVersionGte(getAppVersion(), notice.minVersion)) {
    // 版本门槛拦截（配置驱动公告最常见的「不弹」原因）：开发者工具里版本号为空会
    // 回退 FALLBACK_VERSION（utils/version.ts），若后台 minVersion 高于它则永远不弹。
    console.warn(
      `[popup-notice] 版本门槛拦截：当前 ${getAppVersion()} < 公告要求 ${notice.minVersion}，不展示`,
    )
    return null
  }
  if (!envAllowed(notice.envWhitelist)) {
    // 环境白名单拦截：公告只面向指定环境（如仅体验版 / 正式版，开发版不弹）。
    console.warn(
      `[popup-notice] 环境白名单拦截：当前 ${getAppEnvVersion()} 不在 ${JSON.stringify(notice.envWhitelist)}，不展示`,
    )
    return null
  }
  const today = todayDateString(now)
  let state: unknown = null
  try {
    state = storage.get(storageKey)
  } catch {
    // 存储不可用：不弹，不影响业务
    return null
  }
  const result = shouldShowPopupNotice(notice, today, state)
  if (!result.show) {
    console.warn(
      `[popup-notice] 展示频次拦截（今天已展示过 / 展示天数已用完）：key=${storageKey} state=${JSON.stringify(state)}，不展示`,
    )
    return null
  }
  try {
    storage.set(storageKey, result.state)
  } catch {
    // 写缓存失败：本次照常展示，下次再记
  }
  // 只在默认 wx storage 上清理历史公告键（注入的 storage 由调用方自行管理，无枚举能力）
  if (storage === wxStorage) pruneStaleStateKeys(storageKey)
  return {
    title: notice.title ?? '',
    content: notice.content,
    path: notice.path,
    buttonText: notice.buttonText ?? '',
  }
}

// ---------------------------------------------------------------------------
// 服务端公告 → 弹窗公告（/api/v1/notices position='home'，见 stores/system.store.ts）
// ---------------------------------------------------------------------------

/** 公告 config 是否具备弹窗正文（content 非空字符串）；是则返回收窄后的 config */
function popupConfigOf(notice: Notice): (NoticeConfig & { content: string }) | null {
  const cfg = notice.config
  if (typeof cfg.content !== 'string' || cfg.content.length === 0) return null
  return cfg as NoticeConfig & { content: string }
}

/**
 * 从公告列表解析「首页弹窗公告」（position='home'，服务端 notices 接口驱动）：
 * 取第一条 config 合法的 home 公告（列表已按 pinned DESC, sort ASC 排序），
 * 映射为弹窗配置 + 按公告 id 的展示状态缓存键（`popup_notice_state_{id}`，
 * 与 components/popup-notice 的 storageKey 对应——换公告 = 换缓存键 = 重新计天；
 * 展示命中时由 tryShowPopupNotice 顺带清理其它公告的旧键，见 pruneStaleStateKeys）；
 * 无 home 公告 / 正文缺失时返回 null（不弹）。
 *
 * 缺省兜底：title / buttonText 缺省为空串（组件兜底文案）；path 缺省空串（不跳转）；
 * minVersion 缺省 '0.0.0'（不设版本门槛）；count 缺省 1（只展示一天）；
 * envWhitelist 缺省不限（空数组 = 不限）。
 *
 * envWhitelist 在「取第一条」之前过滤：不命中当前环境的 home 公告直接跳过，
 * 继续看下一条，保证多条公告按环境分流时能选中正确的第一条。
 */
export function resolveHomePopupNotice(
  notices: Notice[],
): { popup: PopupNotice; storageKey: string } | null {
  for (const notice of notices) {
    if (notice.position !== 'home') continue
    const cfg = popupConfigOf(notice)
    if (!cfg) {
      // 最常见的映射失败：后台 config 不是对象（如返回 JSON 字符串）或 content 缺失。
      // docs/API.md 8.2 约定公开端 config「已解析为对象」；若后台原样返回字符串需后端修正。
      console.warn(
        `[popup-notice] home 公告 config 缺少合法 content（需为对象且 content 为非空字符串）：id=${notice.id} config=${JSON.stringify(notice.config)}`,
      )
      continue
    }
    if (!envAllowed(cfg.envWhitelist)) {
      console.warn(
        `[popup-notice] home 公告被环境白名单拦截（当前 ${getAppEnvVersion()}，白名单 ${JSON.stringify(cfg.envWhitelist)}）：id=${notice.id}，跳过`,
      )
      continue
    }
    return {
      popup: {
        title: typeof cfg.title === 'string' ? cfg.title : undefined,
        content: cfg.content,
        path: typeof cfg.path === 'string' ? cfg.path : '',
        buttonText: typeof cfg.buttonText === 'string' ? cfg.buttonText : undefined,
        minVersion: typeof cfg.minVersion === 'string' && cfg.minVersion ? cfg.minVersion : '0.0.0',
        count: typeof cfg.count === 'number' && cfg.count > 0 ? cfg.count : 1,
        envWhitelist: Array.isArray(cfg.envWhitelist)
          ? cfg.envWhitelist.filter((env): env is string => typeof env === 'string')
          : undefined,
      },
      storageKey: `popup_notice_state_${notice.id}`,
    }
  }
  return null
}
