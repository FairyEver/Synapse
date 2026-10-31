import { describe, expect, it } from 'vitest'
import { getCleanupResultMessage } from './cleanup-result'

describe('getCleanupResultMessage', () => {
  it('summarizes successful cleanup results', () => {
    expect(getCleanupResultMessage({ deleted: 2 })).toBe('已清理 2 个日志文件')
  })

  it('summarizes partial cleanup failures without treating the operation as failed', () => {
    expect(getCleanupResultMessage({ deleted: 1, failures: 2 })).toBe(
      '已清理 1 个日志文件，2 个清理失败'
    )
  })
})
