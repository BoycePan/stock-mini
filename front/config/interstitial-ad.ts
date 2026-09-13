/**
 * 插屏广告**默认参数**（总开关 / 展示时机 / 频控 / 重试；本地发版级兜底）。
 *
 * 需求口径（2026-09 确认）：
 * - 核心页面在「页面显示（onShow）」时触发插屏：4 个行情 tab 页（全球/日韩/有色/财经）
 *   + 报价子包（分时/个股详情/板块详情/全部板块/美股TOP100）+ 财经子包（资讯列表/资讯详情）；
 *   设置页不触发。所有触发汇聚到 utils/interstitial-ad.ts 的全局单例——
 *   同一时刻全局只允许一个插屏在「创建/加载/展示」，超出的触发直接丢弃；
 * - **触发时机**（页面显示原因，判定见 utils/page-show.ts）：只有
 *   ① onLoad 后首次显示（冷启动 / 首次切到该 tab / navigateTo 进子页面）、
 *   ② 用户点 tabBar 切 tab、③ App 从后台回前台（可关，见 showOnAppForeground）三者展示；
 *   **从子页面返回（navigateBack）不展示**——返回是浏览过程中最高频的动作；
 * - 两次展示最小间隔默认 15s（从上次展示成功起算，跨启动也生效）；
 * - 按账号注册时间（登录接口返回 user.created_at，见 stores/auth.store.ts）区分新老用户：
 *   注册 ≤ newUserWindowDays(3) 天 = 新用户 → 每天最多 newUserDailyCap(1) 次；
 *   老用户 → 每天最多 dailyCap(3) 次；取不到 created_at 按老用户处理。
 *
 * **本文件的角色 = 默认值（兜底），不是唯一配置源**：插屏的**广告位**与**行为参数**
 * 都在远端 —— 后端 app_config（cfg_type='display'）的 `adConfig` 分组下（docs/API.md 八）：
 * - `interstitialAd`：**广告位列表**，与同组 `bannerAd` 同构的数组，每项
 *   `{ "unit-id": "adunit-…", "location": "global", "status": true }`；
 *   解析 utils/ad-config.ts `resolveInterstitialUnitId`。**没有全局兜底广告位**：
 *   某 location 未配置 / `status=false` → 该位置**不展示**插屏；
 * - `interstitialConfig`：**行为参数**，键名与本文件 `InterstitialAdConfig` 字段一一对应、
 *   全部可选；逐项覆盖下面的默认值（解析 utils/ad-config.ts `resolveInterstitialSettings`：
 *   缺省 / 类型不合法 → 用本文件默认值），后台**只配要覆盖的项**即可；
 * - 两者都即时生效：上下线 / 调参 / 换广告位都无需发版（`status=false` 为单广告位临时下线开关，
 *   远端 `enabled=false` 为整体总开关）；
 * - 冷启动竞态：页面 onShow 通常早于「登录 + 配置」返回，此时调度器挂起本次触发等待
 *   配置到达（上限见 configWaitTimeoutMs），配置始终没有该 location 则不展示；
 * - 配置示例 / 后台建配置步骤见 `docs/广告位配置-插屏广告.json`。
 */

/** 触发插屏的页面位置标识（与各页面 onShow 接入点一一对应，也是远端配置的 location 取值） */
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

/**
 * 插屏行为参数（远端 `adConfig.interstitialConfig` 可逐项覆盖，见文件头）。
 * 每个字段在远端的**键名相同**（后台配置项里就是这些键），本文件的值是缺省兜底。
 */
export interface InterstitialAdConfig {
  /** 总开关：false 时任何页面都不会触发插屏（远端可覆盖；单广告位上下线也可用其 status） */
  enabled: boolean
  /**
   * App 从后台回到前台（该页面非首次显示）时是否允许触发插屏。
   * 用户没有明确这个场景，默认沿用改版前的行为（允许展示）；
   * 若不希望「切后台回来弹广告」，改为 false 即可（从子页面返回一律不展示，不受此开关影响）。
   */
  showOnAppForeground: boolean
  /** 两次展示最小间隔（ms）：默认 15s */
  minIntervalMs: number
  /** 新用户窗口（天）：注册距今天数 ≤ 该值视为新用户 */
  newUserWindowDays: number
  /** 新用户每日最多展示次数（默认：最多弹 1 次） */
  newUserDailyCap: number
  /** 老用户每日最多展示次数（默认：一天 3 次） */
  dailyCap: number
  /** 一次完整「创建→加载→展示」流程的最大尝试次数（含首次；加载/展示失败后的连续重试次数 = maxAttempts - 1） */
  maxAttempts: number
  /** 重试间隔（ms） */
  retryIntervalMs: number
  /** 加载看门狗（ms）：创建后超过该时长仍未 onLoad/展示成功，销毁实例并释放全局锁，避免卡死后续触发 */
  loadTimeoutMs: number
  /**
   * 「等待远端广告位配置」的上限（ms）：冷启动时页面 onShow 早于配置接口返回，
   * 期间插屏触发会被挂起（utils/interstitial-ad.ts scheduleConfigWait），配置到达即补一次；
   * 超过该时长（配置接口失败 / 后台始终没配该 location）则放弃本次触发。
   */
  configWaitTimeoutMs: number
}

/**
 * 插屏参数**默认值**（远端 `adConfig.interstitialConfig` 未配置的项用这里的值；
 * **不含 unit-id**：广告位由远端 `adConfig.interstitialAd` 下发，见文件头与
 * docs/广告位配置-插屏广告.json）。
 */
export const INTERSTITIAL_AD_CONFIG: InterstitialAdConfig = {
  enabled: true,
  showOnAppForeground: true,
  minIntervalMs: 15 * 1000, // 15s
  newUserWindowDays: 3,
  newUserDailyCap: 1,
  dailyCap: 3,
  maxAttempts: 3, // 首次 + 2 次重试
  retryIntervalMs: 1200,
  loadTimeoutMs: 8000,
  configWaitTimeoutMs: 8000,
}
