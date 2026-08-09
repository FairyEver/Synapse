import { ApiError } from './api-client'

export function shouldRetryAdminQuery(failureCount: number, error: unknown) {
  if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
    return false
  }
  return failureCount < 1
}
