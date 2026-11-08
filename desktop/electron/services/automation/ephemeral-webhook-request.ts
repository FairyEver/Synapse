import type { WebhookRawRequest } from "@synapse/shared" with { "resolution-mode": "import" }

// Key by the exact in-memory event. Serialization, templates and persisted run
// state cannot acquire this data; replayed/history-created events have no entry.
const requests = new WeakMap<object, WebhookRawRequest>()
export function attachEphemeralWebhookRequest(event: object, request: WebhookRawRequest): void { requests.set(event, request) }
export function getEphemeralWebhookRequest(event: unknown): WebhookRawRequest | undefined {
  return event && typeof event === "object" ? requests.get(event) : undefined
}
