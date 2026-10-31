import { describe, expect, it } from 'vitest'

import {
  getWebhookResetSecretDialogDescription,
  webhookResetSecretDialogTitle,
} from './webhook-reset-secret'

describe('webhook reset secret confirmation copy', () => {
  it('describes the destructive effect without exposing secrets', () => {
    const desc = getWebhookResetSecretDialogDescription({ name: 'Deploy Hook' })

    expect(webhookResetSecretDialogTitle).toBe('重置 Webhook secret')
    expect(desc).toContain('Deploy Hook')
    expect(desc).toContain('旧 Webhook URL 将立即失效')
    expect(desc).toContain('新 URL 只会在重置后显示一次')
    expect(desc).not.toContain('whsec_')
  })
})
