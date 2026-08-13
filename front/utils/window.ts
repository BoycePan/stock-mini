import type { ThemeMode } from './storage'

/** 窗口背景色（下拉刷新 / 回弹区域），必须跟随主题切换 */
export function syncWindowBackground(theme: ThemeMode): void {
  const backgroundColor = theme === 'dark' ? '#0F1722' : '#F3F6FA'
  wx.setBackgroundColor({
    backgroundColor,
    backgroundColorTop: backgroundColor,
    backgroundColorBottom: backgroundColor,
  })
  wx.setBackgroundTextStyle({ textStyle: theme === 'dark' ? 'light' : 'dark' })
}
