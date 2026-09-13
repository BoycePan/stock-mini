/**
 * 插屏广告频控纯函数（无 wx / store 依赖，便于单测；调度见 utils/interstitial-ad.ts）。
 *
 * 两条规则（配置集中在 config/interstitial-ad.ts）：
 * 1. 新老用户每日上限：按登录返回的 user.created_at 距今天数分级——新用户每天
 *    NEW_USER_DAILY_CAP 次、老用户 DAILY_CAP 次；取不到 created_at / 解析失败按老用户。
 * 2. 本地「当日已展示次数」状态机：{ date: YYYY-MM-DD, count } 跨天自动归零，
 *    只统计真正展示成功的次数（调度器在 show() resolve 后才写入）。
 *
 * 存储键 / 读写封装在 utils/interstitial-ad.ts（走 wx storage，与 popup-notice 的
 * 注入式 storage 用法一致，便于在需要时替换实现）。
 */

/** 当日展示计数状态（本地缓存值） */
export interface DailyShowState {
  /** 计数所属日期 YYYY-MM-DD */
  date: string
  /** 当日已展示成功次数 */
  count: number
}

/** 今日计数 / 上次展示时间的本地缓存键 */
export const INTERSTITIAL_DAILY_KEY = 'market_tracker_interstitial_daily'
export const INTERSTITIAL_LAST_SHOW_KEY = 'market_tracker_interstitial_last_show'

/** 插屏今日计数存储抽象（默认 wx storage，测试可注入内存实现，同 utils/popup-notice.ts） */
export interface InterstitialStorage {
  get(key: string): unknown
  set(key: string, value: DailyShowState | number): void
}

/** 默认存储：wx 本地缓存（未挂 wx 的环境（单测）读写一律返回空值） */
const wxStorage: InterstitialStorage = {
  get(key: string) {
    try {
      return typeof wx !== 'undefined' ? wx.getStorageSync(key) : null
    } catch {
      return null
    }
  },
  set(key: string, value: DailyShowState | number) {
    try {
      if (typeof wx !== 'undefined') wx.setStorageSync(key, value)
    } catch {
      // 写缓存失败不影响展示流程，下次再记
    }
  },
}

/**
 * 距 created_at 的整天数：不足 24h 记 0；created_at 缺失 / 无法解析时返回
 * POSITIVE_INFINITY（使上层按「老用户」处理，保证日上限保守、不偏多）。
 */
export function daysSinceCreated(createdAt: string | null | undefined, now: Date): number {
  if (!createdAt) return Number.POSITIVE_INFINITY
  const created = new Date(createdAt).getTime()
  if (!Number.isFinite(created)) return Number.POSITIVE_INFINITY
  const diff = now.getTime() - created
  if (diff <= 0) return 0 // 未来时间（时钟偏差）按注册当天处理
  return Math.floor(diff / 86400000)
}

/** 新用户窗口判定：注册天数 ≤ windowDays 视为新用户 */
export function isNewUser(days: number, windowDays: number): boolean {
  return days <= windowDays
}

/**
 * 按账号注册时间计算该用户今日插屏上限。
 * - created_at 存在且距今天数 ≤ newUserWindowDays → newUserDailyCap（新用户）；
 * - 其余（老用户 / 取不到 created_at / 解析失败）→ regularDailyCap。
 */
export function userDailyCap(opts: {
  /** user.created_at（登录接口下发；缺失 = 老用户档） */
  userCreatedAt?: string | null
  /** 判定时刻（默认当前时间，便于测试固定） */
  now?: Date
  /** 新用户窗口（天），见 config/interstitial-ad.ts */
  newUserWindowDays: number
  /** 新用户每日上限 */
  newUserDailyCap: number
  /** 老用户每日上限 */
  regularDailyCap: number
}): number {
  const {
    userCreatedAt,
    now = new Date(),
    newUserWindowDays,
    newUserDailyCap,
    regularDailyCap,
  } = opts
  if (isNewUser(daysSinceCreated(userCreatedAt ?? null, now), newUserWindowDays)) {
    return newUserDailyCap
  }
  return regularDailyCap
}

/** 缓存状态是否合法（date + count 齐备） */
export function isValidDailyState(state: unknown): state is DailyShowState {
  return (
    !!state &&
    typeof (state as DailyShowState).date === 'string' &&
    typeof (state as DailyShowState).count === 'number'
  )
}

/** 今日已展示次数：跨天（或非法/空状态）一律视为 0 */
export function todayShownCount(date: string, state: unknown): number {
  if (!isValidDailyState(state)) return 0
  return state.date === date ? state.count : 0
}

/**
 * 记录一次「今日展示成功」并返回最新缓存状态（纯函数，写入由调用方完成）。
 * - 非法 / 空状态 → { date: 今天, count: 1 }；
 * - 今天已有记录 → count + 1；
 * - 跨天 → 重置为 { date: 今天, count: 1 }。
 * 调用方应保证在今日次数 < 上限时才消费（上限判定见 utils/interstitial-ad.ts）。
 */
export function consumeDailyShow(date: string, state: unknown): DailyShowState {
  if (!isValidDailyState(state) || state.date !== date) {
    return { date, count: 1 }
  }
  return { date, count: state.count + 1 }
}

/** 读取今日计数缓存（默认 wx storage） */
export function readDailyState(storage: InterstitialStorage = wxStorage): unknown {
  try {
    return storage.get(INTERSTITIAL_DAILY_KEY)
  } catch {
    return null
  }
}

/** 写入今日计数缓存 */
export function writeDailyState(
  state: DailyShowState,
  storage: InterstitialStorage = wxStorage,
): void {
  try {
    storage.set(INTERSTITIAL_DAILY_KEY, state)
  } catch {
    // 写缓存失败：本次照常展示，下次再记
  }
}

/** 读取上次展示成功时间（ms 时间戳；无记录返回 0） */
export function readLastShowAt(storage: InterstitialStorage = wxStorage): number {
  try {
    const value = storage.get(INTERSTITIAL_LAST_SHOW_KEY)
    return typeof value === 'number' ? value : 0
  } catch {
    return 0
  }
}

/** 写入上次展示成功时间（ms 时间戳；跨启动生效，保证冷启后 15s 内不连环弹） */
export function writeLastShowAt(timestamp: number, storage: InterstitialStorage = wxStorage): void {
  try {
    storage.set(INTERSTITIAL_LAST_SHOW_KEY, timestamp)
  } catch {
    // 写缓存失败不影响展示流程
  }
}
