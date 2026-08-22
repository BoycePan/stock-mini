import type { KlinePoint } from '../../types/stock'
import { buildKlinePosterChart } from '../../utils/kline-poster'
import { buildMinutePosterChart, type MinutePosterChartData } from '../../utils/minute-poster'
import { renderSharePoster, type PosterChart, type PosterData } from '../../utils/share-poster'
import { bindTheme, getTheme, unbindTheme } from '../../utils/theme'

/**
 * 分享海报组件（行情 / 分时 / 新闻详情通用）：
 * - 持有隐藏 Canvas（#shareCanvas）绘制海报并导出临时文件；
 * - 预览弹窗：水印开关（重画）、长按保存 / 转发、保存相册、调起微信图片分享菜单；
 * - 海报由 posterData（标题 / 状态 / 分区指标）+ 内嵌图表组成：
 *   minuteChart（非空，优先）绘制「当日分时」走势图，否则 klines 绘制 K 线走势图，
 *   两者都不传则不绘制图表（新闻等页面用文本段落分区）；
 * - 固定深色底，深浅主题下均清晰可读；弹窗 UI 跟随主题。
 *
 * 页面用法（行情页）：
 * <share-poster id="sharePoster" posterData="{{ posterData }}" klines="{{ klines }}"></share-poster>
 * <share-poster id="sharePoster" posterData="{{ posterData }}" minuteChart="{{ minutePoster }}"></share-poster>
 * app-header 绑定 posterShare + bind:share 后，页面 onSharePoster 调
 * this.selectComponent('#sharePoster').open()。
 *
 * 新闻等无行情页面不传图表（不绘制内嵌图表），海报正文走 posterData 的
 * 文本段落分区（PosterSection.text，见 utils/share-poster.ts）。
 */
Component({
  properties: {
    /** 海报数据（主标题 / 状态文案 / 分区指标等），由页面组装 */
    posterData: { type: Object, value: {} },
    /** K 线数据：非空且未传 minuteChart 时在海报头部下方绘制 K 线走势图（新闻等无行情页面可不传） */
    klines: { type: Array, value: [] },
    /** K 线面板标题 */
    chartTitle: { type: String, value: 'K线走势' },
    /** 分时图数据：非空时在海报头部下方绘制「当日分时」走势图（优先于 klines） */
    minuteChart: { type: Object, value: {} },
  },
  data: {
    theme: 'light',
    shareLoading: false,
    modalVisible: false,
    sharePreviewPath: '',
    includeWatermark: true,
  },
  lifetimes: {
    attached() {
      this.setData({ theme: getTheme() })
      bindTheme(this)
    },
    detached() {
      unbindTheme(this)
    },
  },
  methods: {
    noop() {},
    /**
     * 组装内嵌图表：minuteChart 优先（分时图），否则 klines（K 线图），
     * 两者都无返回 undefined（不绘制图表）。
     */
    buildChart(): PosterChart | undefined {
      const minute = this.data.minuteChart as MinutePosterChartData | null | undefined
      if (minute && minute.points && minute.points.length) {
        return buildMinutePosterChart(
          minute.points,
          minute.preClose ?? 0,
          minute.session ?? 'continuous',
          minute.title,
        )
      }
      const klines = this.data.klines as KlinePoint[]
      if (klines && klines.length) {
        return buildKlinePosterChart(klines, this.data.chartTitle)
      }
      return undefined
    },
    /** 分享按钮入口：校验数据 → 生成海报 → 打开预览弹窗 */
    open() {
      const data = this.data.posterData as PosterData | null
      if (this.data.shareLoading) return
      if (!data || !data.sections || !data.sections.length) {
        wx.showToast({ title: '内容加载中…请稍候', icon: 'none' })
        return
      }
      // 同时打开右上角胶囊菜单的分享能力（onShareAppMessage 在页面层定义）
      wx.showShareMenu({ withShareTicket: true })
      this.setData({ shareLoading: true })
      wx.showLoading({ title: '生成图片中…', mask: true })
      // 内嵌图表可选：分时页传 minuteChart、K 线页传 klines，新闻等页面都不传
      const chart = this.buildChart()
      renderSharePoster(this, data, chart ? { chart } : undefined)
        .then((path) => {
          this.setData({ shareLoading: false, sharePreviewPath: path, modalVisible: true })
          wx.hideLoading()
        })
        .catch((err) => {
          this.setData({ shareLoading: false })
          wx.hideLoading()
          wx.showToast({ title: (err && err.message) || '生成失败，请重试', icon: 'none' })
        })
    },
    hideModal() {
      this.setData({ modalVisible: false, shareLoading: false })
    },
    /** 水印开关：切换后按当前设置重画海报 */
    onWatermarkToggle() {
      if (!this.data.posterData) return
      const next = !this.data.includeWatermark
      this.setData({ includeWatermark: next, shareLoading: true })
      wx.showLoading({ title: '重画图片中…', mask: true })
      const data = { ...(this.data.posterData as PosterData), includeWatermark: next }
      const chart = this.buildChart()
      renderSharePoster(this, data, chart ? { chart } : undefined)
        .then((path) => {
          this.setData({ shareLoading: false, sharePreviewPath: path })
          wx.hideLoading()
        })
        .catch(() => {
          this.setData({ shareLoading: false })
          wx.hideLoading()
        })
    },
    /** 保存海报到相册（需相册权限，拒绝时引导去设置） */
    saveShareImage() {
      wx.showLoading({ title: '保存中…', mask: true })
      wx.saveImageToPhotosAlbum({
        filePath: this.data.sharePreviewPath,
        success: () => {
          wx.hideLoading()
          wx.showToast({ title: '已保存到相册', icon: 'success' })
        },
        fail: (err) => {
          wx.hideLoading()
          if (err && err.errMsg && err.errMsg.indexOf('auth') >= 0) {
            wx.showModal({
              title: '需要相册权限',
              content: '请在设置中允许保存到相册',
              confirmText: '去设置',
              success: (res) => {
                if (res.confirm) wx.openSetting()
              },
            })
          } else {
            wx.showToast({ title: '保存失败，请重试', icon: 'none' })
          }
        },
      })
    },
    /** 调起微信图片分享菜单（转发到会话 / 朋友圈） */
    openShareImageMenu() {
      if (!this.data.sharePreviewPath) {
        wx.showToast({ title: '图片未生成，请重试', icon: 'none' })
        return
      }
      this.setData({ modalVisible: false })
      setTimeout(() => {
        wx.showShareImageMenu({
          path: this.data.sharePreviewPath,
          fail: () => {
            // 旧版本不支持该接口时引导长按图片分享
            wx.showToast({ title: '请长按图片分享', icon: 'none' })
          },
        })
      }, 150)
    },
  },
})
