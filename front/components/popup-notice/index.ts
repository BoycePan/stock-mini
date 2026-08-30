import type { PopupNotice } from '../../types/system'
import { tryShowPopupNotice } from '../../utils/popup-notice'
import { bindTheme, getTheme, unbindTheme } from '../../utils/theme'
import { trackEvent } from '../../utils/tracker'

/** 已调度过的组件实例（同实例只调度一次，避免 observers / attached 重复触发） */
const handledInstances = new WeakSet<object>()

/**
 * 通用弹窗公告组件（公告配置 + 调度规则见 utils/popup-notice.ts）。
 *
 * 弹层基于 tdesign-miniprogram 的 popup 组件（placement="center"，自带遮罩与
 * 缩放渐变动画），卡片内标题 / 正文（rich-text，可滚动）/ 圆角主按钮 / 关闭按钮
 * 全部由本组件自定义渲染；深色主题通过 tdesign CSS 变量 + 组件自身 dark 样式适配。
 *
 * 用法：传入 notice（title / content / path / buttonText / minVersion / count），
 * 组件自管理弹窗生命周期——进入页面时自动校验 minVersion 版本门槛 + count 天每日一次
 * （wx 本地缓存记录日期），命中即弹出；无需调用方写任何调度代码：
 *
 * ```xml
 * <popup-notice notice="{{ popupNotice }}" storage-key="{{ popupStorageKey }}" />
 * ```
 *
 * - notice：弹窗配置；页面可在 data 初始为 null、公告（服务端 notices 接口
 *   position='home'，见 utils/popup-notice.ts resolveHomePopupNotice）异步到达后
 *   再传入——observers 会在 notice 从空变为非空时补一次调度（同实例只弹一次）；
 * - title：弹窗标题（缺省「公告」）；
 * - content：公告正文，支持 HTML（rich-text 渲染，节点子集 p / strong / br / a …）；
 * - path：点主按钮跳转的页面路径；为空时按钮文案变「知道了」仅关闭；
 *   跳转目标与当前页相同视为「知道了」不重复压栈；
 * - buttonText：底部圆角主按钮文案（缺省：有跳转路径「立即查看」，否则「知道了」）；
 * - storageKey：展示状态缓存键，建议按公告 id 区分（换公告 = 换键 = 重新计天），
 *   同一条公告全端共用同一键即可去重；
 * - 事件：bind:close（关闭，含遮罩 / 关闭按钮 / 主按钮）、bind:show（命中展示，可做埋点或扩展）。
 */
Component({
  properties: {
    /** 公告配置（PopupNotice）；null / 空 content 不弹 */
    notice: { type: Object, value: null as unknown as PopupNotice },
    /** 展示状态缓存键（PopupNoticeState，utils/popup-notice.ts） */
    storageKey: { type: String, value: 'popup_notice_state' },
  },
  data: {
    theme: 'light' as string,
    visible: false,
    /** 弹窗标题（配置缺省时兜底「公告」） */
    title: '',
    /** 弹窗正文（HTML，rich-text 渲染） */
    content: '',
    /** 弹窗跳转路径（空 = 不跳转，按钮文案「知道了」） */
    path: '',
    /** 底部主按钮文案（配置缺省时：有跳转路径「立即查看」，否则「知道了」） */
    buttonText: '',
  },
  lifetimes: {
    attached() {
      this.setData({ theme: getTheme() })
      bindTheme(this)
      this.maybeShow()
    },
    detached() {
      unbindTheme(this)
    },
  },
  observers: {
    /** notice 属性变化（如服务端公告异步到达）时重新调度；同实例只调度一次 */
    notice() {
      this.maybeShow()
    },
  },
  methods: {
    /**
     * 调度：minVersion 版本门槛 + count 天每日一次，命中则弹出。
     * notice 为空（服务端公告未到达）时不占用「已调度」标记，等 notice 异步
     * 变为非空时 observers 会再次触发本方法补调度。
     */
    maybeShow() {
      const notice = this.data.notice as PopupNotice | null
      if (!notice) return
      if (handledInstances.has(this)) return
      handledInstances.add(this)
      const shown = tryShowPopupNotice(notice, this.data.storageKey)
      if (!shown) {
        // 数据已到达组件但被调度规则拦截（版本门槛 / 今日已展示），原因见上方 tryShowPopupNotice 日志
        console.warn(
          '[popup-notice] 收到公告但未展示（拦截原因见上方日志）',
          notice,
          this.data.storageKey,
        )
        return
      }
      trackEvent('popup.notice.show')
      this.setData({
        visible: true,
        title: shown.title || '公告',
        content: shown.content,
        path: shown.path,
        buttonText: shown.buttonText || (shown.path ? '立即查看' : '知道了'),
      })
    },

    /** 关闭弹窗（关闭按钮 / 遮罩 / 主按钮）：同步 visible 并通知父级 */
    onClose() {
      this.setData({ visible: false })
      this.triggerEvent('close')
    },

    /** t-popup 遮罩点击回调（closeOnOverlayClick 开启时触发） */
    onVisibleChange(event: WechatMiniprogram.CustomEvent<{ visible: boolean; trigger: string }>) {
      if (!event.detail.visible) this.onClose()
    },

    /** 点主按钮：有跳转路径则跳转并关闭，否则仅关闭 */
    onConfirm() {
      this.onClose()
      // 跳转目标就是当前页时视为「知道了」，避免重复压栈
      const pages = getCurrentPages()
      const current = pages[pages.length - 1]
      const route = current ? `/${current.route}` : ''
      if (route === this.data.path) return
      trackEvent('popup.notice.tap')
      wx.navigateTo({ url: this.data.path })
    },

    /** 空处理：卡片内 catchtap 拦截冒泡（点卡片不触达遮罩） */
    noop() {},
  },
})
