/**
 * tabbar 数据页 / 分时页的自动刷新：
 * - 页面可见（onShow）时启动：距上次请求数据超过 5s 才立即静默刷新一次，之后每 intervalMs 刷新一次；
 * - 页面不可见（onHide/onUnload）时停止，不占用资源、不产生请求；
 * - 已有加载进行中（下拉刷新/首屏）时跳过，避免并发重复请求。
 */

const AUTO_REFRESH_INTERVAL = 10000
/** onShow 立即刷新的门闩：距上次请求不足该值时不补刷新，避免刚请求过又重复请求 */
const MIN_REFRESH_GAP = 5000

type TimerId = ReturnType<typeof setInterval>

const timers = new WeakMap<object, TimerId>()

export interface AutoRefreshPage {
  data?: { loading?: boolean }
  /** 可选提供加载状态查询函数，优先于 page.data.loading（可直读 MobX store 单一数据源，避开 setData 异步时差） */
  isLoading?: () => boolean
  loadData: (options?: { silent?: boolean }) => Promise<boolean | void>
}

/** 获取页面当前的真实加载状态 */
export function isPageLoading(page: AutoRefreshPage): boolean {
  if (typeof page.isLoading === 'function') {
    return Boolean(page.isLoading())
  }
  return Boolean(page.data?.loading)
}

/**
 * 启动自动刷新。
 * @param lastLoadAt 最近一次真正发起数据请求的时间戳（毫秒，0 = 从未请求过），
 *                   由调用方（页面 / Store）在真实请求处记录；用于 onShow 立即刷新门闩。
 * @param intervalMs 刷新间隔（毫秒），默认 10s（分时页传入 8000 实现 8s 刷新）。
 */
export function startAutoRefresh(
  page: AutoRefreshPage,
  lastLoadAt?: number,
  intervalMs = AUTO_REFRESH_INTERVAL,
): void {
  stopAutoRefresh(page)
  // 回到当前页时立即补一次刷新：仅当距上次请求超过 5s 且无加载进行中时才发起，避免刚加载完又重复请求
  if (!isPageLoading(page) && Date.now() - (lastLoadAt ?? 0) > MIN_REFRESH_GAP) {
    void page.loadData({ silent: true })
  }
  timers.set(
    page,
    setInterval(() => {
      if (!isPageLoading(page)) {
        void page.loadData({ silent: true })
      }
    }, intervalMs),
  )
}

export function stopAutoRefresh(page: AutoRefreshPage): void {
  const timer = timers.get(page)
  if (timer !== undefined) {
    clearInterval(timer)
    timers.delete(page)
  }
}
