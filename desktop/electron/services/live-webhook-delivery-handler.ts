import type { WebhookDeliveryReceivedPayload } from "@synapse/shared" with { "resolution-mode": "import" }
import type { AutomationTriggerEvent } from "./automation/types"
import type { AutomationService } from "./automation"
import { createMainLogger } from "./log-store"

const liveProtocolPromise = import("@synapse/shared")

type LiveWebhookDeliveryLogger = Pick<ReturnType<typeof createMainLogger>, "info" | "warn">

export interface LiveWebhookDeliveryHandlerDeps {
  readonly automation: Pick<AutomationService, "acceptEvent">
  readonly logger?: LiveWebhookDeliveryLogger
}

export class LiveWebhookDeliveryHandler {
  private readonly automation: Pick<AutomationService, "acceptEvent">
  private readonly logger: LiveWebhookDeliveryLogger

  constructor(deps: LiveWebhookDeliveryHandlerDeps) {
    this.automation = deps.automation
    this.logger = deps.logger ?? createMainLogger("service.live-webhook")
  }

  async handle(payload: WebhookDeliveryReceivedPayload): Promise<void> {
    const event = await createWebhookAutomationEvent(payload)
    try {
      const runs = await this.automation.acceptEvent(event)
      this.logger.info("Live webhook delivery accepted.", {
        source: "live-webhook",
        deliveryId: payload.deliveryId,
        webhookPublicId: payload.webhook.publicId,
        receivedAt: payload.request.receivedAt,
        acceptedCount: runs.length,
        boundary: "live-webhook-delivery",
      })
    } catch (error) {
      this.logger.warn("Live webhook delivery failed.", {
        source: "live-webhook",
        deliveryId: payload.deliveryId,
        webhookPublicId: payload.webhook.publicId,
        receivedAt: payload.request.receivedAt,
        boundary: "live-webhook-delivery",
        ...errorMetadata(error),
      })
    }
  }
}

export async function createWebhookAutomationEvent(
  payload: WebhookDeliveryReceivedPayload,
): Promise<AutomationTriggerEvent> {
  const { LIVE_MESSAGE_TYPES } = await liveProtocolPromise
  return {
    source: "webhook",
    type: LIVE_MESSAGE_TYPES.webhookDeliveryReceived,
    receivedAt: payload.request.receivedAt,
    payload: {
      deliveryId: payload.deliveryId,
      webhook: payload.webhook,
      request: {
        method: payload.request.method,
        url: payload.request.url,
        query: payload.request.query,
        headers: payload.request.headers,
        body: payload.request.body,
        receivedAt: payload.request.receivedAt,
        ...(payload.request.bodyText !== undefined ? { bodyText: payload.request.bodyText } : {}),
        ...(payload.request.contentType !== undefined ? { contentType: payload.request.contentType } : {}),
        ...(payload.request.remoteAddress !== undefined ? { remoteAddress: payload.request.remoteAddress } : {}),
      },
    },
  }
}

function errorMetadata(error: unknown): { readonly errorName: string; readonly errorLength: number } {
  const message = error instanceof Error ? error.message : String(error)
  return {
    errorName: error instanceof Error ? error.name : typeof error,
    errorLength: message.length,
  }
}
