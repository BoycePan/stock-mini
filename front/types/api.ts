export interface ApiResponse<T> {
  code: number
  msg: string
  data?: T
}

export interface ApiErrorShape {
  code: number
  message: string
  status?: number
  isNetworkError?: boolean
}

export type RequestMethod = 'GET' | 'POST' | 'PUT' | 'DELETE'
