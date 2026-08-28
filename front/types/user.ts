import type { AppConfig } from './system'

export interface User {
  id: number
  nickname?: string | null
  avatar_url?: string | null
  status: number
  last_login_at?: string | null
  created_at?: string
  updated_at?: string
}

export interface LoginResult {
  token: string
  expires_in: number
  user: User
  /** cfg_type='login' 的系统配置（docs/API.md 8.3），无 login 配置时为空对象 */
  config?: AppConfig
}
