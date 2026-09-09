import { isReleaseBuild } from '../config/env'
import { rootStore } from '../stores/root.store'
import type { AppConfig } from '../types/system'

/** 开发版 / 体验版配置键后缀：线上正式版键 + 'Dev' */
const DEV_KEY_SUFFIX = 'Dev'

type FeatureToggleKey = keyof NonNullable<AppConfig['config']>

/**
 * 「正式键 + Dev 键」双键布尔读取核心（display 开关工厂与 login 配置开关解析器共用）：
 * 线上正式版（release）读 `<releaseKey>`、开发版 / 体验版（develop / trial）读自动推导的
 * `<releaseKey>Dev`；配置未就绪（undefined）或键缺省一律 false（缺省关闭），
 * 绝不等配置接口、不影响行情首屏加载；配置到达后下一次刷新即生效。
 */
function pickDualKeyToggle<C extends object>(
  config: C | undefined,
  releaseKey: keyof C & string,
  release: boolean,
): boolean {
  if (!config) return false
  const key = (release ? releaseKey : `${releaseKey}${DEV_KEY_SUFFIX}`) as keyof C & string
  return (config[key] as boolean | undefined) ?? false
}

/**
 * createFeatureToggle — 「双环境布尔开关」解析器工厂（配置驱动，见 docs/API.md 八「前端配置与公告」）。
 *
 * 后台 app_config（cfg_type='display'）为每个开关维护一对键：
 * - `<releaseKey>`：线上正式版（release）读取；
 * - `<releaseKey>Dev`：开发版 / 体验版（develop / trial）读取（自动推导）；
 * - 配置未就绪（首屏配置接口尚未返回，如冷启动竞态）或键缺省 → false（缺省关闭），
 *   绝不等配置接口、不影响行情首屏加载；配置到达后下一次刷新即生效。
 *
 * 返回**纯函数**（环境判定由调用方传入 config/env.ts isReleaseBuild），便于单测；
 * 便捷读取当前环境用 `bindToggle`（自动读全局配置 store + 运行环境）。
 *
 * 新增一个开关三步：
 * 1. `front/types/system.ts` 的 `AppConfig.config` 增加一对键 `<key>` / `<key>Dev`；
 * 2. 本文件 `export const resolveXxxEnabled = createFeatureToggle('<key>')`（纯函数）；
 * 3. 调用方需当前环境判定时 `export const isXxxEnabled = bindToggle(resolveXxxEnabled)`。
 *
 * @param releaseKey 线上正式版配置键
 */
export function createFeatureToggle(
  releaseKey: FeatureToggleKey,
): (config: AppConfig['config'], release: boolean) => boolean {
  return (config, release) => pickDualKeyToggle(config, releaseKey, release)
}

/**
 * bindToggle — 便捷绑定：把纯解析器绑定到「当前运行环境 + 全局配置 store」。
 * 调用点不再需要自己传 `rootStore.system.configs.config` 与 `isReleaseBuild()`，
 * 直接 `isXxxEnabled()` 即可；读取配置是响应式的（MobX 绑定自动追踪，配置到达即时生效）。
 */
export function bindToggle(
  resolve: (config: AppConfig['config'], release: boolean) => boolean,
): () => boolean {
  return () => resolve(rootStore.system.configs.config, isReleaseBuild())
}

/** 美股「市值TOP100」入口卡是否展示（线上正式版读 homeShowTop100，开发/体验版读 homeShowTop100Dev） */
export const resolveTop100Enabled = createFeatureToggle('homeShowTop100')

/** 分时行情页（packageQuote/pages/minute）入口开关（线上正式版读 canShowMinute，开发/体验版读 canShowMinuteDev） */
export const resolveMinuteEnabled = createFeatureToggle('canShowMinute')

/** 便捷版：当前环境是否展示「市值TOP100」入口卡 */
export const isTop100Enabled = bindToggle(resolveTop100Enabled)

/** 便捷版：当前环境是否开放分时行情页（关闭时「分时」角标隐藏 + 各入口跳转拦截，见调用方） */
export const isMinuteEnabled = bindToggle(resolveMinuteEnabled)

/**
 * 设置页「开发者选项」（接口环境切换）入口是否展示（pages/settings/index）：
 * 与 homeShowTop100 / canShowMinute 的「正式键 + Dev 键」双键模式**不同**，userShowEnv 为
 * 单一键、无 Dev 尾缀——正式 / 开发 / 体验版统一读 userShowEnv（后端只维护一个键），
 * 配置未就绪 / 键缺省一律 false（缺省关闭）。返回纯函数（只读 config），
 * 便于单测；调用方仍需自行叠加环境限制（设置页入口 = isDev && isUserShowEnvEnabled()，
 * 即仅开发 / 体验版可能展示，正式版恒不展示）。
 */
export const resolveUserShowEnvEnabled = (config: AppConfig['config']): boolean =>
  config?.userShowEnv ?? false

/** 便捷版：后台 display 配置 userShowEnv 是否开启（读全局配置 store，配置到达即时生效） */
export const isUserShowEnvEnabled = bindToggle((config) => resolveUserShowEnvEnabled(config))

/**
 * 首页「A股指数 + 美股指数」主入口分区是否展示（**login 配置驱动**，与 display 开关的
 * 「正式键 + Dev 键」双键语义一致）：
 * - 配置源为 `cfg_type='login'`、跟随登录接口下发（`LoginResult.config` 里的顶层分组
 *   `loginConfig`，见 types/user.ts / types/system.ts LoginConfig 与 docs/API.md 8.3），
 *   由 rootStore.bootstrap 登录成功后写入 `rootStore.system.loginConfig`，登录后即用、
 *   无需再单独请求配置接口（复用「登录下发 login 配置」链路）；
 * - 线上正式版读 `showMainEntrance`，开发版 / 体验版读 `showMainEntranceDev`（自动推导
 *   + 'Dev' 尾缀）；配置未就绪 / 键缺省一律 false（缺省不展示该分区）。
 * 返回纯函数（只读 loginConfig 分组、环境判定由调用方传入），便于单测。
 */
export const resolveMainEntranceEnabled = (
  config: AppConfig['loginConfig'],
  release: boolean,
): boolean => pickDualKeyToggle(config, 'showMainEntrance', release)

/** 便捷版：当前环境首页是否展示「A股指数 + 美股指数」主入口分区
 *  （读全局 login 配置 store rootStore.system.loginConfig，登录配置到达即时生效）。 */
export const isMainEntranceEnabled = (): boolean =>
  resolveMainEntranceEnabled(rootStore.system.loginConfig.loginConfig, isReleaseBuild())
