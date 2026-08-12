import { developmentEnv } from './env.development'
import { productionEnv } from './env.production'
import { getApiBaseUrl } from '../utils/storage'

export interface AppEnv {
  apiBaseUrl: string
  requestTimeout: number
}

function isReleaseBuild() {
  try {
    return wx.getAccountInfoSync().miniProgram.envVersion !== 'develop'
  } catch {
    return false
  }
}

const currentEnv = isReleaseBuild() ? productionEnv : developmentEnv

/** 环境默认地址优先，其次使用设置页保存的自定义 API 地址 */
export function getEnv(): AppEnv {
  return {
    ...currentEnv,
    apiBaseUrl: getApiBaseUrl() || currentEnv.apiBaseUrl,
  }
}
