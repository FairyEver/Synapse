import type { RendererAutomationTriggerDefinition } from "../../types.shared"
import { WebhookTriggerConfigForm } from "./config.renderer"
import {
  summarizeWebhookTriggerConfig,
  type WebhookTriggerConfig,
  webhookTriggerManifest,
} from "./index.shared"

export const webhookRendererTriggerDefinition = {
  manifest: webhookTriggerManifest,
  summarizeConfig: summarizeWebhookTriggerConfig,
  ConfigForm: WebhookTriggerConfigForm,
} satisfies RendererAutomationTriggerDefinition<WebhookTriggerConfig>

export type { WebhookTriggerConfig }
