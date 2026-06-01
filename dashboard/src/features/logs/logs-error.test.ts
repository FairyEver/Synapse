import { describe, expect, it } from 'vitest'

import { getLogsQueryErrorMessage } from './logs-error'

describe('getLogsQueryErrorMessage', () => {
  it('uses readable error messages', () => {
    expect(getLogsQueryErrorMessage(new Error('日志目录不可读'))).toBe(
      '日志目录不可读'
    )
    expect(getLogsQueryErrorMessage('网络异常')).toBe('网络异常')
  })

  it('falls back for unreadable errors', () => {
    expect(getLogsQueryErrorMessage(new Error(''))).toBe('系统日志加载失败')
    expect(getLogsQueryErrorMessage(null)).toBe('系统日志加载失败')
  })
})
