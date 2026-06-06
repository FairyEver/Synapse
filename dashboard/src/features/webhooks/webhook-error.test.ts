import { describe, expect, it } from 'vitest'

import { getWebhookErrorMessage } from './webhook-error'

describe('getWebhookErrorMessage', () => {
  it('uses useful error messages', () => {
    expect(getWebhookErrorMessage(new Error('名称不能为空'))).toBe('名称不能为空')
    expect(getWebhookErrorMessage('请求失败')).toBe('请求失败')
  })

  it('falls back for empty or unknown errors', () => {
    expect(getWebhookErrorMessage(new Error('   '), '保存失败')).toBe('保存失败')
    expect(getWebhookErrorMessage(null, '删除失败')).toBe('删除失败')
  })
})
