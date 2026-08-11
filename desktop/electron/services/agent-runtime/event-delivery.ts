import type { EventBusEmitOptions } from "../../runtime/event-bus"

export function agentConversationDeliveryOptions(
  projectId: string,
  conversationId: string | undefined,
): EventBusEmitOptions {
  return {
    backpressure: "block",
    ...(conversationId ? { orderingKey: `agent:${projectId}:${conversationId}` } : {}),
  }
}
