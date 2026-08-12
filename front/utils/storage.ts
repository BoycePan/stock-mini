const TOKEN_KEY = 'market_magic_token'
const USER_KEY = 'market_magic_user'
const THEME_KEY = 'market_magic_theme'
const API_BASE_URL_KEY = 'market_magic_api_base_url'
const NEWS_DETAIL_KEY = 'market_magic_news_detail'
const MOCK_FALLBACK_KEY = 'market_magic_mock_fallback'

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

export function setTheme(theme: ThemeMode): void {
  wx.setStorageSync(THEME_KEY, theme)
  // getApp() may return undefined during App.onLaunch because the app instance
  // is not registered yet, so guard before touching globalData.
  const app = getApp<{ globalData: { theme?: ThemeMode } }>()
  if (app) {
    app.globalData.theme = theme
  }
}

export function getApiBaseUrl(): string {
  return read(API_BASE_URL_KEY, '')
}

export function setApiBaseUrl(url: string): void {
  wx.setStorageSync(API_BASE_URL_KEY, url.trim().replace(/\/$/, ''))
}

export function getMockFallback(): boolean {
  return read(MOCK_FALLBACK_KEY, true)
}

export function setMockFallback(enabled: boolean): void {
  wx.setStorageSync(MOCK_FALLBACK_KEY, enabled)
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

export function clearAppStorage(): void {
  clearToken()
  clearUser()
  wx.removeStorageSync(THEME_KEY)
  wx.removeStorageSync(API_BASE_URL_KEY)
  wx.removeStorageSync(MOCK_FALLBACK_KEY)
}
