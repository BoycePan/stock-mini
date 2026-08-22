import type { MarketPageData } from '../types/market'

const TOKEN_KEY = 'market_tracker_token'
const USER_KEY = 'market_tracker_user'
const THEME_KEY = 'market_tracker_theme'
const API_BASE_URL_KEY = 'market_tracker_api_base_url'
const NEWS_DETAIL_KEY = 'market_tracker_news_detail'
const SEARCH_HISTORY_KEY = 'market_tracker_search_history'
const SEARCH_HISTORY_LIMIT = 10
const FINANCE_CACHE_KEY = 'market_tracker_finance_cache'

export type ThemeMode = 'light' | 'dark'
/** 主题偏好：'system' 表示跟随微信客户端主题（默认），'light' / 'dark' 为用户手动选择 */
export type ThemePreference = 'system' | ThemeMode

function read<T>(key: string, fallback: T): T {
  try {
    const value = wx.getStorageSync(key)
    return (value || fallback) as T
  } catch {
    return fallback
  }
}

export function getToken(): string {
  return read(TOKEN_KEY, '')
}

export function setToken(token: string): void {
  wx.setStorageSync(TOKEN_KEY, token)
}

export function clearToken(): void {
  wx.removeStorageSync(TOKEN_KEY)
}

export function getUser<T>(): T | null {
  return read<T | null>(USER_KEY, null)
}

export function setUser<T>(user: T): void {
  wx.setStorageSync(USER_KEY, user)
}

export function clearUser(): void {
  wx.removeStorageSync(USER_KEY)
}

export function getThemePreference(): ThemePreference {
  const pref = read<ThemePreference>(THEME_KEY, 'system')
  return pref === 'system' || pref === 'light' || pref === 'dark' ? pref : 'system'
}

/** 读取微信客户端当前生效主题（跟随系统深色模式）。需 app.json 配置 darkmode:true，否则恒为 light */
function getSystemTheme(): ThemeMode {
  try {
    const info =
      typeof wx.getAppBaseInfo === 'function' ? wx.getAppBaseInfo() : wx.getSystemInfoSync()
    return info.theme === 'dark' ? 'dark' : 'light'
  } catch {
    return 'light'
  }
}

/**
 * 把主题偏好解析为实际生效主题：
 * - 'system' → 跟随微信客户端主题（systemTheme 优先用于主题变化事件回调，避免二次读取）；
 * - 'light' / 'dark' → 手动选择，直接生效。
 */
export function resolveTheme(pref: ThemePreference, systemTheme?: ThemeMode): ThemeMode {
  if (pref !== 'system') return pref
  if (systemTheme) return systemTheme
  return getSystemTheme()
}

/** 当前实际生效主题（已解析），组件 attached 等场景拿到的就是最终渲染值 */
export function getTheme(): ThemeMode {
  return resolveTheme(getThemePreference())
}

type ThemeListener = (theme: ThemeMode) => void

const themeListeners = new Set<ThemeListener>()

/**
 * 订阅主题变更：setTheme() 会立即通知所有订阅者（页面 / 自定义组件），
 * 返回取消订阅函数。主题切换必须走 setTheme()，不要直接改 globalData。
 */
export function onThemeChange(listener: ThemeListener): () => void {
  themeListeners.add(listener)
  return () => {
    themeListeners.delete(listener)
  }
}

/**
 * 持久化主题偏好，并把解析后的实际主题写入 globalData / 广播给订阅者。
 * 用户手动选择浅色 / 深色即写入显式偏好，之后不再跟随系统。
 */
export function setTheme(pref: ThemePreference, systemTheme?: ThemeMode): void {
  const resolved = resolveTheme(pref, systemTheme)
  wx.setStorageSync(THEME_KEY, pref)
  // getApp() may return undefined during App.onLaunch because the app instance
  // is not registered yet, so guard before touching globalData.
  const app = getApp<{ globalData: { theme?: ThemeMode } }>()
  if (app) {
    app.globalData.theme = resolved
  }
  // 广播给所有存活页面 / 组件，保证主题切换即时生效
  themeListeners.forEach((listener) => listener(resolved))
}

export function getApiBaseUrl(): string {
  return read(API_BASE_URL_KEY, '')
}

export function setApiBaseUrl(url: string): void {
  wx.setStorageSync(API_BASE_URL_KEY, url.trim().replace(/\/$/, ''))
}

export interface NewsDetail {
  /** 后端新闻 id：列表进入由 saveNewsDetail 写入，详情页分享时回带到分享路径 */
  id?: string
  title: string
  summary: string
  url: string
  source: string
  time: string
}

export function saveNewsDetail(detail: NewsDetail): void {
  wx.setStorageSync(NEWS_DETAIL_KEY, detail)
}

export function getNewsDetail(): NewsDetail | null {
  return read<NewsDetail | null>(NEWS_DETAIL_KEY, null)
}

/**
 * 财经资讯页数据缓存：接口响应慢，进入页面先展示本地缓存，
 * 再后台刷新最新数据，刷新成功后覆盖缓存。
 */
export function getFinanceCache(): MarketPageData | null {
  return read<MarketPageData | null>(FINANCE_CACHE_KEY, null)
}

export function setFinanceCache(data: MarketPageData): void {
  wx.setStorageSync(FINANCE_CACHE_KEY, data)
}

export function getSearchHistory(): string[] {
  const history = read<unknown>(SEARCH_HISTORY_KEY, [])
  return Array.isArray(history)
    ? history.filter((item): item is string => typeof item === 'string')
    : []
}

/** 记录一条搜索记录：去重后插入最前，最多保留 SEARCH_HISTORY_LIMIT 条，返回最新列表 */
export function addSearchHistory(keyword: string): string[] {
  const q = keyword.trim()
  if (!q) return getSearchHistory()
  const history = getSearchHistory().filter((item) => item !== q)
  history.unshift(q)
  const next = history.slice(0, SEARCH_HISTORY_LIMIT)
  wx.setStorageSync(SEARCH_HISTORY_KEY, next)
  return next
}

export function clearSearchHistory(): void {
  wx.removeStorageSync(SEARCH_HISTORY_KEY)
}

export function clearAppStorage(): void {
  clearToken()
  clearUser()
  wx.removeStorageSync(THEME_KEY)
  wx.removeStorageSync(API_BASE_URL_KEY)
}
