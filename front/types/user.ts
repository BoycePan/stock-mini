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
}
