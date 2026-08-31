import type { Notice, NoticeConfig, PopupNotice } from '../types/system'
import { isVersionGte, getAppVersion } from './version'

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

/** 非法 / 损坏的缓存状态视为「从未展示」，重新走首次展示逻辑 */
function isValidState(state: unknown): state is PopupNoticeState {
  return (
    !!state &&
    typeof (state as PopupNoticeState).firstShownDate === 'string' &&
    typeof (state as PopupNoticeState).lastShownDate === 'string'
  )
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
 * 弹窗公告通用调度：一次调用完成「minVersion 校验 + count 天每日一次」判断，
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
 * 与 components/popup-notice 的 storageKey 对应——换公告 = 换缓存键 = 重新计天）；
 * 无 home 公告 / 正文缺失时返回 null（不弹）。
 *
 * 缺省兜底：title / buttonText 缺省为空串（组件兜底文案）；path 缺省空串（不跳转）；
 * minVersion 缺省 '0.0.0'（不设版本门槛）；count 缺省 1（只展示一天）。
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
    return {
      popup: {
        title: typeof cfg.title === 'string' ? cfg.title : undefined,
        content: cfg.content,
        path: typeof cfg.path === 'string' ? cfg.path : '',
        buttonText: typeof cfg.buttonText === 'string' ? cfg.buttonText : undefined,
        minVersion: typeof cfg.minVersion === 'string' && cfg.minVersion ? cfg.minVersion : '0.0.0',
        count: typeof cfg.count === 'number' && cfg.count > 0 ? cfg.count : 1,
      },
      storageKey: `popup_notice_state_${notice.id}`,
    }
  }
  return null
}
