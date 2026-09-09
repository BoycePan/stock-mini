/**
 * 插屏广告统一配置（集中管理：开关 / 广告位 / 频控 / 新老用户每日上限）。
 *
 * 需求口径（2026-09 确认）：
 * - 核心页面在「页面显示（onShow）」时触发插屏：4 个行情 tab 页（全球/日韩/有色/财经）
 *   + 报价子包（分时/个股详情/板块详情/全部板块/美股TOP100）+ 财经子包（资讯列表/资讯详情）；
 *   设置页不触发。所有触发汇聚到 utils/interstitial-ad.ts 的全局单例——
 *   同一时刻全局只允许一个插屏在「创建/加载/展示」，超出的触发直接丢弃；
 * - 两次展示最小间隔 MIN_INTERVAL_MS = 15s（从上次展示成功起算，跨启动也生效）；
 * - 按账号注册时间（登录接口返回 user.created_at，见 stores/auth.store.ts）区分新老用户：
 *   注册 ≤ NEW_USER_WINDOW_DAYS(3) 天 = 新用户 → 每天最多 NEW_USER_DAILY_CAP(1) 次；
 *   老用户 → 每天最多 DAILY_CAP(3) 次；取不到 created_at 按老用户处理。
 *
 * unit-id 当前为**前端硬编码**（已填正式广告位：首页_插屏 + 日韩_插屏，映射见文末）；
 * 正式投放如需后台远程控制开关/换位，可改为后端 app_config(display).adConfig 下发
 * （与 components/ad-banner 的 bannerAd 同机制），届时仅需改 utils/interstitial-ad.ts 的
 * resolveUnitId 读取后端配置，其余闸门/计数逻辑不变。
 */

/** 触发插屏的页面位置标识（与各页面 onShow 接入点一一对应） */
export type InterstitialLocation =
  /** 4 个行情 tab 页 */
  | 'global' // 全球
  | 'asia' // 日韩
  | 'metals' // 有色
  | 'finance' // 财经
  /** packageQuote 报价子包 */
  | 'minute' // 分时图
  | 'stock-detail' // 个股详情
  | 'sector-detail' // 板块详情
  | 'industry-all' // 全部板块
  | 'us-top100' // 美股市值TOP100
  /** packageNews 财经子包 */
  | 'news' // 资讯列表
  | 'news-detail' // 资讯详情

export interface InterstitialAdConfig {
  /** 总开关：false 时任何页面都不会触发插屏 */
  enabled: boolean
  /** 插屏广告位 unit-id（微信公众平台「流量主」创建）。
   *   **全局兜底广告位**：未在 unitIdByLocation 单独配置的页面共用此广告位。
   *   微信广告位可跨页面复用，填一个已开启的即可让全部核心页都能出插屏；
   *   之后想按页面用独立广告位（分开展示/数据），在 unitIdByLocation 加一行即可。 */
  unitId: string
  /** 按 location 覆盖的 unit-id（优先于 unitId）；未配置的 location 使用 unitId */
  unitIdByLocation: Partial<Record<InterstitialLocation, string>>
  /** 两次展示最小间隔（ms）：需求确认 15s */
  minIntervalMs: number
  /** 新用户窗口（天）：注册距今天数 ≤ 该值视为新用户 */
  newUserWindowDays: number
  /** 新用户每日最多展示次数（需求：最多弹 1 次） */
  newUserDailyCap: number
  /** 老用户每日最多展示次数（需求：一天 3 次） */
  dailyCap: number
  /** 一次完整「创建→加载→展示」流程的最大尝试次数（含首次；加载/展示失败后的连续重试次数 = maxAttempts - 1） */
  maxAttempts: number
  /** 重试间隔（ms） */
  retryIntervalMs: number
  /** 加载看门狗（ms）：创建后超过该时长仍未 onLoad/展示成功，销毁实例并释放全局锁，避免卡死后续触发 */
  loadTimeoutMs: number
}

/**
 * 插屏广告位映射（微信公众平台「流量主」后台创建的广告位）：
 * - 首页_插屏 `adunit-3ad8476bdced05ca`：首页（global）使用，并作为全局兜底，
 *   日韩之外的其余核心页面（有色/财经/分时/个股/板块/TOP100/资讯等）在创建独立
 *   广告位前暂共用此位（同一 unit-id 可被多个页面请求展示）；
 * - 日韩_插屏 `adunit-c0b2e35a4896986f`：日韩（asia）页专用。
 */
export const INTERSTITIAL_AD_CONFIG: InterstitialAdConfig = {
  enabled: true,
  // 全局兜底 = 首页_插屏（已开启）：首页本身与其余未单独配置的页面共用
  unitId: 'adunit-3ad8476bdced05ca',
  unitIdByLocation: {
    // 首页_插屏：与全局兜底同号（显式声明，便于阅读 / 日后替换）
    global: 'adunit-3ad8476bdced05ca',
    // 日韩_插屏（已开启）：日韩 tab 页专用
    asia: 'adunit-c0b2e35a4896986f',
    // 其余 location（metals/finance/minute/stock-detail/sector-detail/industry-all/
    // us-top100/news/news-detail）回退全局兜底 unitId；如需独立广告位在此补行：
    // metals: 'adunit-xxxx…',
  },
  minIntervalMs: 15 * 1000, // 15s
  newUserWindowDays: 3,
  newUserDailyCap: 1,
  dailyCap: 3,
  maxAttempts: 3, // 首次 + 2 次重试
  retryIntervalMs: 1200,
  loadTimeoutMs: 8000,
}
