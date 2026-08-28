import type { LoginResult, User } from '../types/user'
import { LOGIN_SOURCE } from '../config/app'
import { request } from './client'

export const authApi = {
  login(code: string) {
    return request<LoginResult>({
      path: '/api/v1/auth/login',
      method: 'POST',
      data: { code, source: LOGIN_SOURCE },
      skipLoginWait: true,
    })
  },
  profile() {
    return request<User>({
      path: '/api/v1/user/profile',
      withAuth: true,
    })
  },
}
