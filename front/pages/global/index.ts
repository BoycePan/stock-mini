import { rootStore } from '../../stores/root.store'
import { isTop100Enabled } from '../../utils/system-config'
import { createMarketPage } from '../../utils/market-page-factory'

/**
 * 首页是否展示「美股市值TOP100」入口卡：由后端 display 配置（app_config，docs/API.md 八）决定——
 * 线上正式版读 homeShowTop100，开发版/体验版读 homeShowTop100Dev（utils/system-config.ts，
 * isTop100Enabled 自动读取当前环境 + 全局配置 store）。
 * 判读是纯视图层同步读 store（MobX 绑定自动追踪，配置到达时卡片即时出现），
 * 不进数据加载路径，不影响其他数据加载速度；配置未就绪时缺省隐藏。
 */
const showTop100 = () => isTop100Enabled()

createMarketPage({
  pageKey: 'global',
  loadingText: '正在加载全球行情',
  loadingDesc: '正在为您同步全球主要市场最新数据，请稍候…',
  showTop100,
  // 首页弹窗公告（服务端 notices 接口 position='home' 驱动）：进入首页按规则弹出——
  // minVersion 版本门槛 + count 天每日一次（utils/popup-notice.ts），点击跳转 TOP100 列表页。
  // 公告标题 / 内容 / 跳转路径 / 按钮文案 / 版本门槛 / 展示天数由管理端在公告配置中维护，
  // 无需发版；展示状态缓存键按公告 id 区分（utils/popup-notice.ts resolveHomePopupNotice）。
  // 接口未配置 home 公告时返回 null，页面不弹窗。
  popupNotice: () => rootStore.system.homePopupNotice,
  popupStorageKey: () => rootStore.system.homePopupStorageKey,
})
