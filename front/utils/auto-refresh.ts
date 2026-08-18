/**
 * tabbar 数据页的自动刷新：
 * - 页面可见（onShow）时启动：立即静默刷新一次，之后每 10s 刷新一次；
 * - 页面不可见（onHide/onUnload）时停止，不占用资源、不产生请求；
 * - 已有加载进行中（下拉刷新/首屏）时跳过，避免并发重复请求。
 */

const AUTO_REFRESH_INTERVAL = 10_000

type TimerId = ReturnType<typeof setInterval>

const timers = new WeakMap<object, TimerId>()

export interface AutoRefreshPage {
  data: { loading?: boolean }
  loadData: (options?: { silent?: boolean }) => Promise<boolean | void>
}

export function startAutoRefresh(page: AutoRefreshPage): void {
  stopAutoRefresh(page)
  // 回到当前页时立即补一次刷新，避免展示过久的数据
  if (!page.data.loading) {
    void page.loadData({ silent: true })
  }
  timers.set(
    page,
    setInterval(() => {
      if (!page.data.loading) {
        void page.loadData({ silent: true })
      }
    }, AUTO_REFRESH_INTERVAL),
  )
}

export function stopAutoRefresh(page: AutoRefreshPage): void {
  const timer = timers.get(page)
  if (timer !== undefined) {
    clearInterval(timer)
    timers.delete(page)
  }
}
