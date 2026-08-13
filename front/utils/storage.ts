const TOKEN_KEY = 'market_magic_token'
const USER_KEY = 'market_magic_user'
const THEME_KEY = 'market_magic_theme'
const API_BASE_URL_KEY = 'market_magic_api_base_url'
const NEWS_DETAIL_KEY = 'market_magic_news_detail'
const SEARCH_HISTORY_KEY = 'market_magic_search_history'
const SEARCH_HISTORY_LIMIT = 10

export type ThemeMode = 'light' | 'dark'

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

export function getTheme(): ThemeMode {
  return read<ThemeMode>(THEME_KEY, 'light')
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

export function setTheme(theme: ThemeMode): void {
  wx.setStorageSync(THEME_KEY, theme)
  // getApp() may return undefined during App.onLaunch because the app instance
  // is not registered yet, so guard before touching globalData.
  const app = getApp<{ globalData: { theme?: ThemeMode } }>()
  if (app) {
    app.globalData.theme = theme
  }
  // 广播给所有存活页面 / 组件，保证主题切换即时生效
  themeListeners.forEach((listener) => listener(theme))
}

export function getApiBaseUrl(): string {
  return read(API_BASE_URL_KEY, '')
}

export function setApiBaseUrl(url: string): void {
  wx.setStorageSync(API_BASE_URL_KEY, url.trim().replace(/\/$/, ''))
}

export interface NewsDetail {
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
