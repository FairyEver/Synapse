import type { WebhookTriggerConfig } from "./schema"

export {
  type WebhookTriggerConfig,
  webhookTriggerConfigSchema,
} from "./schema"
export { webhookTriggerManifest } from "./manifest"

export function summarizeWebhookTriggerConfig(config: WebhookTriggerConfig): string {
  if (config.webhookName) return `Webhook · ${config.webhookName}`
  if (config.webhookPublicId) return `Webhook · ${config.webhookPublicId}`
  return "Webhook"
}
