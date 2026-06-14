import type { DashboardWebhookDto } from '@synapse/shared'

export const webhookResetSecretDialogTitle = '重置 Webhook secret'

export function getWebhookResetSecretDialogDescription(webhook: Pick<DashboardWebhookDto, 'name'> | null): string {
  const name = webhook?.name ? `「${webhook.name}」` : '该 Webhook'
  return `${name} 的旧 Webhook URL 将立即失效，新 URL 只会在重置后显示一次。`
}
