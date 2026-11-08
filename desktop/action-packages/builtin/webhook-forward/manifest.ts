import type { ActionManifest } from "../../types"
import { webhookForwardActionConfigSchema, type WebhookForwardActionConfig } from "./schema"

export const webhookForwardActionManifest = {
  id: "builtin.webhook-forward", title: "接口转发", permissions: ["network.connect"],
  supportedTriggerTypes: ["builtin.webhook"], previousOutputs: "none",
  defaultConfig: { url: "" }, configSchema: webhookForwardActionConfigSchema,
  configFields: [{ name: "url", kind: "string", required: true, description: "Literal HTTP/HTTPS destination URL. Webhook triggers only; forwards original method, query, headers and entity bytes. No template expansion or redirects. A complete 2xx response within 30 seconds means forwarding accepted, not downstream business completion. Original content is live-only and never recovered from history." }],
} satisfies ActionManifest<WebhookForwardActionConfig>
