import { Webhook } from "lucide-react"
import type { RendererAutomationTriggerDefinition } from "../../types.shared"
import { WebhookTriggerConfigForm } from "./config.renderer"
import {
  summarizeWebhookTriggerConfig,
  type WebhookTriggerConfig,
  webhookTriggerManifest,
} from "./index.shared"

export const webhookRendererTriggerDefinition = {
  manifest: webhookTriggerManifest,
  manualRunUnavailableReason: "请发送 Webhook 请求触发，不能无事件手动运行",
  icon: Webhook,
  summarizeConfig: summarizeWebhookTriggerConfig,
  ConfigForm: WebhookTriggerConfigForm,
} satisfies RendererAutomationTriggerDefinition<WebhookTriggerConfig>

export type { WebhookTriggerConfig }
