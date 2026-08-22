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

const defaultEnv = isReleaseBuild() ? productionEnv : developmentEnv

/**
 * 获取当前运行时环境配置。
 * - 非线上版本可通过「开发者选项」写入 EnvOverride 覆盖接口地址；
 * - 线上版本 override 永不生效，始终使用 productionEnv。
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
