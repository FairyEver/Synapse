import { describe, expect, it } from 'vitest'

import { getSystemOverviewErrorMessage } from './system-error'

describe('getSystemOverviewErrorMessage', () => {
  it('uses readable error messages', () => {
    expect(getSystemOverviewErrorMessage(new Error('数据库连接失败'))).toBe(
      '数据库连接失败'
    )
    expect(getSystemOverviewErrorMessage('网络异常')).toBe('网络异常')
  })

  it('falls back for unreadable errors', () => {
    expect(getSystemOverviewErrorMessage(new Error(''))).toBe(
      '系统概览加载失败'
    )
    expect(getSystemOverviewErrorMessage(null)).toBe('系统概览加载失败')
  })
})
