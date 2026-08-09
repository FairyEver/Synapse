import { describe, expect, it } from 'vitest'
import { ApiError } from './api-client'
import { shouldRetryAdminQuery } from './admin-query-retry'

describe('shouldRetryAdminQuery', () => {
  it.each([401, 403])('does not replay admin authorization failures with status %s', (status) => {
    expect(shouldRetryAdminQuery(0, new ApiError('管理会话无效。', status))).toBe(false)
  })

  it('preserves one retry for other query failures', () => {
    expect(shouldRetryAdminQuery(0, new ApiError('服务暂时不可用。', 503))).toBe(true)
    expect(shouldRetryAdminQuery(1, new ApiError('服务暂时不可用。', 503))).toBe(false)
  })
})
