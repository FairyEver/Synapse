import type {
  AutomationEventInput,
  AutomationTriggerRuntime,
} from "../../types.shared"
import type { WebhookTriggerConfig } from "./schema"

const liveProtocolPromise = import("@synapse/shared")

export const webhookTriggerRuntime: AutomationTriggerRuntime<WebhookTriggerConfig> = {
  async shouldAcceptEvent(input: AutomationEventInput<WebhookTriggerConfig>): Promise<boolean> {
    const { LIVE_MESSAGE_TYPES } = await liveProtocolPromise
    const webhookPublicId = webhookPublicIdFromEvent(input.event.payload)
    return input.event.source === "webhook" &&
      input.event.type === LIVE_MESSAGE_TYPES.webhookDeliveryReceived &&
      webhookPublicId === input.config.webhookPublicId
  },
  getReschedulePolicy: () => ({ mode: "none" }),
}

function webhookPublicIdFromEvent(payload: Record<string, unknown>): string | null {
  const webhook = payload.webhook
  if (!webhook || typeof webhook !== "object" || Array.isArray(webhook)) return null
  const publicId = (webhook as { readonly publicId?: unknown }).publicId
  return typeof publicId === "string" && publicId.trim() ? publicId : null
}
