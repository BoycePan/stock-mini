import { rootStore } from '../../stores/root.store'
import {
  createStoreBindings,
  registerStoreBinding,
  releaseStoreBindings,
} from '../../utils/store-bindings'
import { bindTheme, getTheme, unbindTheme } from '../../utils/theme'
import { resolveAdUnitId } from '../../utils/ad-config'

/**
 * 广告位组件（原生模板广告 <ad-custom>）。
 *
 * 配置驱动：后端 app_config（cfg_type='display'）的 adConfig 分组下发广告位
 * （utils/ad-config.ts resolveAdUnitId 按 location 查找 + status 校验）——
 * 组件通过 MobX 绑定读取 rootStore.system.configs.adConfig，配置到达时广告位即时出现；
 * 未配置 / 未启用 / 配置未就绪时 unitId 为空串，组件整体不渲染（不影响页面布局）。
 *
 * 用法：
 * ```xml
 * <ad-banner location="homeTop" placement="card" />
 * ```
 *
 * - location：广告位标识（homeTop / homeIndustry / asiaTop / matalsTop / finance /
 *   minute-detail / finance-detail / us-top100 / industry-all），决定查找哪个 unit-id；
 *   同一页面可挂多个广告位（不同 location），见 components/market-page 的 adLocation / adLocation2；
 * - placement：外边距布局——
 *   - card：行情页分区卡片之间（与 section-card 对齐，左右 20rpx）；
 *   - inline：内容卡片内部（如财经页新闻列表第二条之后，上下留白）；
 *   - top：全宽内容区块（无左右内缩，仅上下留白），用于分时图下方 / 新闻详情页正文下方（原文链接上方）。
 * - 圆角裁剪：组件根节点自带 border-radius + overflow:hidden，广告内容按圆角裁切。
 * - 事件：bindload / binderror / bindclose 组件内部已监听并打印日志（见 methods）。
 */
Component({
  properties: {
    /** 广告位 location（对应后端 adConfig.bannerAd[].location） */
    location: { type: String, value: '' },
    /** 外边距布局：card（默认，分区卡片间）/ inline（内容卡片内）/ top（页面顶部） */
    placement: { type: String, value: 'card' },
  },
  data: {
    theme: 'light' as string,
    /** 解析出的广告 unit-id；空串表示未配置 / 未启用 / 配置未就绪，组件不渲染 */
    unitId: '',
    showSuccess: true,
  },
  lifetimes: {
    attached() {
      this.setData({ theme: getTheme() })
      bindTheme(this)
      registerStoreBinding(
        this,
        createStoreBindings(this, {
          store: rootStore.system,
          fields: {
            /** 按 location 解析 unit-id：adConfig 异步到达（MobX 自动追踪）时即时刷新 */
            unitId: () => resolveAdUnitId(rootStore.system.configs.adConfig, this.data.location),
          },
          actions: [],
        }),
      )
    },
    detached() {
      releaseStoreBindings(this)
      unbindTheme(this)
    },
  },
  methods: {
    /** 原生模板广告加载成功 */
    onAdLoad() {
      console.log(`[ad-banner] 原生模板广告加载成功 location=${this.data.location}`)
    },
    /** 原生模板广告加载失败（unit-id 无效 / 未开通流量主等） */
    onAdError(event: WechatMiniprogram.CustomEvent) {
      console.error(
        `[ad-banner] 原生模板广告加载失败 location=${this.data.location}`,
        event?.detail,
      )
      this.setData({ showSuccess: false })
    },
    /** 原生模板广告关闭 */
    onAdClose() {
      console.log(`[ad-banner] 原生模板广告关闭 location=${this.data.location}`)
    },
  },
})
