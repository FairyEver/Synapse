import type {
  ActionStoredConfigValidation,
} from "../../../action-packages/types"
import type { AutomationTriggerDefinition } from "../../types.shared"
import {
  summarizeWebhookTriggerConfig,
  type WebhookTriggerConfig,
  webhookTriggerConfigSchema,
  webhookTriggerManifest,
} from "./index.shared"
import { webhookTriggerRuntime } from "./runtime.main"

export const webhookTriggerDefinition = {
  manifest: webhookTriggerManifest,
  manualRunUnavailableReason: "请发送 Webhook 请求触发，不能无事件手动运行",
  summarize: summarizeWebhookTriggerConfig,
  validateStoredConfig(config: unknown): ActionStoredConfigValidation {
    const parsed = webhookTriggerConfigSchema.safeParse(config)
    return parsed.success
      ? { status: "valid", issues: [] }
      : { status: "needs_update", issues: [{ field: "trigger.config.webhookPublicId", message: "选择 Webhook" }] }
  },
  runtime: webhookTriggerRuntime,
} satisfies AutomationTriggerDefinition<WebhookTriggerConfig>
