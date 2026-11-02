import type { DashboardWebhookDto } from '@synapse/shared'

export const webhookResetSecretDialogTitle = '重置调用地址'

export function getWebhookResetSecretDialogDescription(webhook: Pick<DashboardWebhookDto, 'name'> | null): string {
  const name = webhook?.name ? `「${webhook.name}」` : '该 Webhook'
  return `${name} 的旧 Webhook URL 将立即失效。重置后，请更新外部服务中的接入地址。`
}
