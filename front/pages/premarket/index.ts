/**
 * 美股盘前行情 Demo 页面（纯前端演示）。
 *
 * 页面复用仓库既有 `app-header` + `section-card` + `loading-state` + `disclaimer-footer`
 * 组件与 `section-card` 组件完成行情卡片渲染；顶部为当前美国市场阶段状态胶囊
 * （盘中=绿 / 盘前盘后=蓝 / 休市=灰）。数据来自 `api/premarket.ts`（东方财富公开接口）。
 * 主题只依赖 `bindTheme` + 根节点 `class="page theme-{{theme}}"`（AGENTS.md 规范）。
 */
import { getPremarketPage } from '../../api/premarket'
import { bindTheme, unbindTheme } from '../../utils/theme'
import { metricViewModel } from '../../utils/market'
import { rootStore } from '../../stores/root.store'
import { hasMinuteSources } from '../../config/minute'
import { startAutoRefresh, stopAutoRefresh } from '../../utils/auto-refresh'
import { SHARE_IMAGE_URL } from '../../utils/share'
import type { MarketSection } from '../../types/market'

/** 行情自动刷新间隔（毫秒）：与「数据每60秒刷新一次」文案保持一致 */
const REFRESH_INTERVAL = 60_000

Page({
  data: {
    theme: rootStore.settings.theme,
    loading: true,
    error: '',
    statusLabel: '',
    statusTone: 'rest' as 'active' | 'quiet' | 'rest',
    updatedLabel: '',
    sections: [] as MarketSection[],
    title: '美股盘前',
  },
  /** 最近一次真正发起数据请求的时间戳（毫秒），供 onShow 补刷门闩使用（见 utils/auto-refresh.ts） */
  lastLoadAt: 0,

  // 自动刷新需要：页面是否仍为当前展示页（页面栈顶）
  isCurrentPage() {
    const pages = getCurrentPages()
    const current = pages[pages.length - 1]
    return current === (this as unknown as WechatMiniprogram.Page.TrivialInstance)
  },

  onLoad() {
    bindTheme(this)
    void this.loadData()
  },

  onShow() {
    // 距上次真正的请求超过 5s 才在 onShow 立即补一次刷新；之后每 60s 轮询一次
    startAutoRefresh(
      this as unknown as Parameters<typeof startAutoRefresh>[0],
      this.lastLoadAt,
      REFRESH_INTERVAL,
    )
  },

  onHide() {
    stopAutoRefresh(this as unknown as Parameters<typeof stopAutoRefresh>[0])
  },

  async onPullDownRefresh() {
    try {
      await this.loadData({ force: true })
    } finally {
      wx.stopPullDownRefresh()
    }
  },

  async loadData(options?: { force?: boolean; silent?: boolean }) {
    const { silent = false } = options ?? {}
    this.lastLoadAt = Date.now()
    if (!silent) this.setData({ loading: true, error: '' })
    try {
      const data = await getPremarketPage()
      const sections = data.sections.map((section) => ({
        ...section,
        metrics: section.metrics.map((metric) => ({
          ...metricViewModel(metric),
          // 标记该卡片是否支持点击查看当日分时（用于「分时」角标与点击行为）
          minuteAvailable: hasMinuteSources(metric.minuteCode ?? metric.code ?? ''),
        })),
      }))
      // silent 刷新失败不覆盖已有数据：仅成功时才更新展示
      this.setData({
        statusLabel: data.statusLabel,
        statusTone: data.statusTone,
        updatedLabel: data.updatedLabel,
        sections,
        // 标题随当前美国市场阶段联动（盘中/盘前/盘后/休市），避免「盘前标题 + 盘中胶囊」自相矛盾
        title: data.statusLabel,
        loading: false,
        error: '',
      })
    } catch (error) {
      if (silent) {
        console.warn('[premarket] 自动刷新失败:', error)
        return
      }
      this.setData({
        loading: false,
        error: error instanceof Error ? error.message : '美股行情加载失败',
      })
    }
  },

  onRetry() {
    void this.loadData({ force: true })
  },

  /**
   * 点击行情卡片：指数（有 minuteCode）进入对应分时图；个股暂无分时源时提示。
   */
  onMetricTap(
    event: WechatMiniprogram.CustomEvent<{
      metric?: { code?: string; minuteCode?: string; name?: string }
    }>,
  ) {
    const metric = event.detail.metric
    const code = metric?.minuteCode ?? metric?.code ?? ''
    if (!code || !hasMinuteSources(code)) {
      wx.showToast({ title: '盘前行情暂无分时图', icon: 'none' })
      return
    }
    wx.navigateTo({
      url: `/pages/minute/index?code=${encodeURIComponent(metric?.code ?? code)}&name=${encodeURIComponent(metric?.name ?? '')}`,
    })
  },

  onUnload() {
    stopAutoRefresh(this as unknown as Parameters<typeof stopAutoRefresh>[0])
    unbindTheme(this)
  },

  onShareAppMessage(): WechatMiniprogram.Page.ICustomShareContent {
    return {
      title: '美股盘前行情',
      path: '/pages/premarket/index',
      imageUrl: SHARE_IMAGE_URL,
    }
  },
})
