import { rootStore } from '../../stores/root.store'
import { bindTheme, unbindTheme } from '../../utils/theme'

/** 开发者联系方式二维码（阿里云 OSS 静态资源） */
const QR_CODE_URL = 'https://jzo2o-pan-oss.oss-cn-hangzhou.aliyuncs.com/images/qrcode.jpg'

Page({
  data: {
    theme: rootStore.settings.theme,
    qrCodeUrl: QR_CODE_URL,
    qrError: false,
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
})
