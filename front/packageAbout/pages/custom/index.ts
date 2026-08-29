import { rootStore } from '../../../stores/root.store'
import { bindTheme, unbindTheme } from '../../../utils/theme'
import { trackEvent } from '../../../utils/tracker'
import { SHARE_IMAGE_URL } from '../../../utils/share'
import { APP_NAME } from '../../../config/app'

/** 开发者联系方式二维码（阿里云 OSS 静态资源） */
const QR_CODE_URL = 'https://jzo2o-pan-oss.oss-cn-hangzhou.aliyuncs.com/images/qrcode.jpg'

Page({
  data: {
    theme: rootStore.settings.theme,
    qrCodeUrl: QR_CODE_URL,
    qrError: false,
    /** 当前小程序名称（按 AppID 动态解析，引言文案展示） */
    appName: APP_NAME,
    tips: [
      '反馈问题请说明：所在页面、操作步骤、出现现象',
      '附上截图或录屏，定位更高效',
      '功能建议请描述使用场景和期望效果',
    ] as string[],
  },
  onLoad() {
    bindTheme(this)
  },
  onUnload() {
    unbindTheme(this)
  },
  onQrError() {
    this.setData({ qrError: true })
  },
  onRetryQr() {
    this.setData({ qrError: false })
  },
  onShareAppMessage(): WechatMiniprogram.Page.ICustomShareContent {
    trackEvent('share.trigger')
    return {
      title: `意见反馈 - ${APP_NAME}`,
      path: '/packageAbout/pages/custom/index',
      imageUrl: SHARE_IMAGE_URL,
    }
  },
})
