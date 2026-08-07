import { developmentEnv } from './env.development'
import { productionEnv } from './env.production'
import { getApiBaseUrl } from '../utils/storage'

export interface AppEnv {
  apiBaseUrl: string
  requestTimeout: number
  useMockFallback: boolean
}

function isReleaseBuild() {
  try {
    return wx.getAccountInfoSync().miniProgram.envVersion !== 'develop'
    // return wx.getAccountInfoSync().miniProgram.envVersion === 'release'
  } catch {
    return false
  }
}

const currentEnv = isReleaseBuild() ? productionEnv : developmentEnv

export function getEnv(): AppEnv {
  return {
    ...currentEnv,
    apiBaseUrl: getApiBaseUrl() || currentEnv.apiBaseUrl,
  }
}
