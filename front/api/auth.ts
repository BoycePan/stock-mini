import type { LoginResult, User } from '../types/user'
import { request } from './client'

export const authApi = {
  login(code: string) {
    return request<LoginResult>({
      path: '/api/v1/auth/login',
      method: 'POST',
      data: { code },
    })
  },
  profile() {
    return request<User>({
      path: '/api/v1/user/profile',
      withAuth: true,
    })
  },
}
