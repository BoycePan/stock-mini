import { developmentEnv } from './env.development'
import { productionEnv } from './env.production'
import { getEnvOverride } from '../utils/storage'

export interface AppEnv {
  apiBaseUrl: string
  requestTimeout: number
}

export function isReleaseBuild(): boolean {
  try {
    return wx.getAccountInfoSync().miniProgram.envVersion === 'release'
  } catch {
    return false
  }
}

/**
 * 默认环境：无论正式版 / 开发版 / 体验版，首次进入（无 EnvOverride）一律使用线上环境。
 * 非线上版本可通过「开发者选项 → 接口环境切换」显式覆盖为本地开发。
 */
const defaultEnv = productionEnv

/**
 * 获取当前运行时环境配置。
 * - 非线上版本可通过「开发者选项」写入 EnvOverride 覆盖接口地址；
 * - 线上版本 override 永不生效，始终使用 productionEnv；
 * - 开发版 / 体验版无覆盖时默认即 productionEnv（首次进入使用线上环境）。
 */
export function getEnv(): AppEnv {
  if (!isReleaseBuild()) {
    const override = getEnvOverride()
    if (override === 'production') {
      return { ...defaultEnv, apiBaseUrl: productionEnv.apiBaseUrl }
    }
    if (override === 'local') {
      return { ...defaultEnv, apiBaseUrl: developmentEnv.apiBaseUrl }
    }
  }
  return { ...defaultEnv }
}
