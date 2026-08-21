import type { MarketSection } from '../../types/market'
import { bindTheme, getTheme, unbindTheme } from '../../utils/theme'
import {
  APP_NAME,
  buildPosterSections,
  formatShareStamp,
  renderSharePoster,
  type PosterData,
} from '../../utils/share-poster'

Component({
  properties: {
    /** 是否显示搜索按钮 */
    showSearch: { type: Boolean, value: true },
    /** 是否显示分享按钮 */
    showShare: { type: Boolean, value: false },
    /** 分享海报主标题（如「全球市场行情」「日韩市场行情」「有色行情」） */
    shareTitle: { type: String, value: '行情速览' },
    /** 是否正在加载 */
    loading: { type: Boolean, value: true },
    /** 错误信息 */
    error: { type: String, value: '' },
    /** 加载中提示主文本 */
    loadingText: { type: String, value: '正在加载行情' },
    /** 加载中提示副文本 */
    loadingDesc: { type: String, value: '正在为您同步最新数据，请稍候…' },
    /** 市场状态标签（如「开市中」「休市」） */
    statusLabel: { type: String, value: '' },
    /** 市场状态色调：'open' | 'rest' */
    statusTone: { type: String, value: 'rest' },
    /** 数据更新时间标签 */
    updatedLabel: { type: String, value: '' },
    /** 板块数据列表 */
    sections: { type: Array, value: [] as MarketSection[] },
  },
  data: {
    theme: 'light',
    shareLoading: false,
    shareModalVisible: false,
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
    onRetry() {
      this.triggerEvent('retry')
    },
    onShare() {
      this.generateSharePoster()
    },
    onMetricTap(event: WechatMiniprogram.CustomEvent) {
      this.triggerEvent('metrictap', event.detail)
    },
    noop() {},
    /** 组装海报数据（实时行情来自 sections 属性） */
    buildShareData(): PosterData {
      return {
        title: this.data.shareTitle || '行情速览',
        subtitle: APP_NAME,
        statusText: this.data.statusLabel || '',
        stamp: formatShareStamp(new Date()),
        includeWatermark: this.data.includeWatermark,
        sections: buildPosterSections(this.data.sections as MarketSection[]),
      }
    },
    /** 分享按钮：生成海报 → 预览弹窗（可转发 / 保存相册） */
    generateSharePoster() {
      const sections = this.data.sections as MarketSection[]
      if (this.data.shareLoading) return
      if (this.data.loading || !sections || !sections.length) {
        wx.showToast({ title: '行情加载中…请稍候', icon: 'none' })
        return
      }
      // 同时打开右上角胶囊菜单的分享能力（onShareAppMessage 在页面层定义）
      wx.showShareMenu({ withShareTicket: true })
      this.setData({ shareLoading: true })
      wx.showLoading({ title: '生成图片中…', mask: true })
      renderSharePoster(this, this.buildShareData())
        .then((path) => {
          this.setData({ shareLoading: false, sharePreviewPath: path, shareModalVisible: true })
          wx.hideLoading()
        })
        .catch((err) => {
          this.setData({ shareLoading: false })
          wx.hideLoading()
          wx.showToast({ title: (err && err.message) || '生成失败，请重试', icon: 'none' })
        })
    },
    hideShareModal() {
      this.setData({ shareModalVisible: false, shareLoading: false })
    },
    /** 水印开关：切换后按当前设置重画海报 */
    onWatermarkToggle() {
      const next = !this.data.includeWatermark
      this.setData({ includeWatermark: next, shareLoading: true })
      wx.showLoading({ title: '重画图片中…', mask: true })
      renderSharePoster(this, this.buildShareData())
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
      this.setData({ shareModalVisible: false })
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
