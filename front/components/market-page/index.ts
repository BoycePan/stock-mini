import type { MarketSection } from '../../types/market'
import { bindTheme, getTheme, unbindTheme } from '../../utils/theme'
import {
  APP_NAME,
  buildPosterSections,
  formatShareStamp,
  renderSharePoster,
  type PosterData,
} from '../../utils/share-poster'

/**
 * 已卸载的组件实例：海报生成（图片加载 + canvasToTempFilePath，约 0.5~1s）期间用户退出页面时，
 * 异步回调不再对已销毁组件 setData（框架会告警且数据被丢弃）。
 * wx.hideLoading 是全局遮罩，无论是否已卸载都必须关闭。
 */
const detachedInstances = new WeakSet<object>()
/** 转发菜单延迟调起的定时器句柄（按实例存放），detached 时清理 */
const shareMenuTimers = new WeakMap<object, ReturnType<typeof setTimeout>>()

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
    /**
     * 图片分享的「小程序入口路径」（wx.showShareImageMenu 的 entrancePath，基础库 3.2.0+）：
     * 接收方在微信中点开分享图片上的「打开小程序」时进入的页面。
     * 行情页本身无需参数，传当前页路径（如 pages/global/index，分享路径不带前导斜杠）
     * 保证入口确定，不依赖微信「默认取当前页面路径」的行为（页面不允许分享时可能回落首页）。
     * 空串时不传 entrancePath（回退微信默认行为）。
     */
    entrancePath: { type: String, value: '' },
    /**
     * 广告位 location（对应后端 adConfig.bannerAd[].location，如 homeTop / asiaTop / matalsTop）。
     * 空串不展示广告；非空时在 adAfterSection 指定分区卡片之后渲染 <ad-banner>。
     */
    adLocation: { type: String, value: '' },
    /** 广告插入位置：渲染在 id 等于该值的分区卡片之后（如 cn-index / asia-kr-index / metal-precious） */
    adAfterSection: { type: String, value: '' },
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
      detachedInstances.add(this)
      const timer = shareMenuTimers.get(this)
      if (timer) clearTimeout(timer)
      shareMenuTimers.delete(this)
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
    /** 面板内 Tab 切换（section-card 冒泡）：透传给页面处理（选中态由页面 / store 持有） */
    onSectionTabTap(event: WechatMiniprogram.CustomEvent) {
      this.triggerEvent('tabtap', event.detail)
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
          // 全局遮罩先关（即使组件已卸载）；再按存活状态决定是否 setData
          wx.hideLoading()
          if (detachedInstances.has(this)) return
          this.setData({ shareLoading: false, sharePreviewPath: path, shareModalVisible: true })
        })
        .catch((err) => {
          wx.hideLoading()
          if (detachedInstances.has(this)) return
          this.setData({ shareLoading: false })
          wx.showToast({ title: (err && err.message) || '生成失败，请重试', icon: 'none' })
        })
    },
    hideShareModal() {
      this.setData({ shareModalVisible: false, shareLoading: false })
    },
    /** 水印开关：切换后按当前设置重画海报 */
    onWatermarkToggle() {
      // 生成中忽略切换：两次生成共用同一张隐藏画布，并发会互相重置画布尺寸 / 上下文变换，
      // 造成绘制与导出交错、导出半张或错位的图
      if (this.data.shareLoading) return
      const next = !this.data.includeWatermark
      this.setData({ includeWatermark: next, shareLoading: true })
      wx.showLoading({ title: '重画图片中…', mask: true })
      renderSharePoster(this, this.buildShareData())
        .then((path) => {
          wx.hideLoading()
          if (detachedInstances.has(this)) return
          this.setData({ shareLoading: false, sharePreviewPath: path })
        })
        .catch(() => {
          wx.hideLoading()
          if (detachedInstances.has(this)) return
          this.setData({ shareLoading: false })
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
      // 定时器句柄登记到实例：detached 时清理，避免卸载后仍调起分享菜单
      const existing = shareMenuTimers.get(this)
      if (existing) clearTimeout(existing)
      shareMenuTimers.set(
        this,
        setTimeout(() => {
          shareMenuTimers.delete(this)
          // entrancePath（基础库 3.2.0+）：指定接收方从分享图片打开小程序的入口页面，
          // 避免依赖微信「默认取当前页面路径」的兜底行为（见属性注释，分享路径不带前导斜杠）。
          // 本地 typings 未收录 entrancePath（3.2.0 新增），运行时多余参数会被忽略。
          const options: WechatMiniprogram.ShowShareImageMenuOption & { entrancePath?: string } = {
            path: this.data.sharePreviewPath,
            fail: () => {
              // 旧版本不支持该接口时引导长按图片分享
              wx.showToast({ title: '请长按图片分享', icon: 'none' })
            },
          }
          if (this.data.entrancePath) options.entrancePath = this.data.entrancePath
          wx.showShareImageMenu(options)
        }, 150),
      )
    },
  },
})
