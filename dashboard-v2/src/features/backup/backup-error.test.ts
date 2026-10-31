import { describe, expect, it } from 'vitest'

import { getBackupListErrorMessage } from './backup-error'

describe('getBackupListErrorMessage', () => {
  it('uses readable error messages', () => {
    expect(getBackupListErrorMessage(new Error('备份目录不可读'))).toBe(
      '备份目录不可读'
    )
    expect(getBackupListErrorMessage('网络异常')).toBe('网络异常')
  })

  it('falls back for unreadable errors', () => {
    expect(getBackupListErrorMessage(new Error(''))).toBe('备份列表加载失败')
    expect(getBackupListErrorMessage(null)).toBe('备份列表加载失败')
  })
})
