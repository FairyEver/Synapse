import type {
  DispatchActorIdentity,
  DispatchContext,
  DispatchResult,
} from "../../../synapse-capabilities/shared/types"
import { mcpClientActorForSource } from "../../../synapse-capabilities/shared/types"
import { SYSTEM_NOTIFIER_TRIGGER_CAPABILITY_ID } from "../shared/capability"
import { validateSystemNotificationInput } from "../shared/schema"
import type { SystemNotifierService } from "./service"

export type SystemNotifierCapabilityDispatcher = {
  dispatch(action: string, params: Record<string, unknown>, context: DispatchContext): Promise<DispatchResult>
}

export function createSystemNotifierCapabilityDispatcher(deps: {
  readonly service: Pick<SystemNotifierService, "trigger">
}): SystemNotifierCapabilityDispatcher {
  return {
    async dispatch(action, params, context) {
      if (action !== SYSTEM_NOTIFIER_TRIGGER_CAPABILITY_ID) {
        throw new Error(`Unknown system notifier action: ${action}`)
      }
      if (context.source !== "mcp-http" && context.source !== "mcp-stdio") {
        throw new Error("System notifier MCP entry requires a trusted MCP source.")
      }

      const validation = validateSystemNotificationInput(params)
      if (!validation.ok) return validation

      const actor = context.actor ?? mcpClientActorForSource(context.source)
      const result = deps.service.trigger(validation.data, {
        source: context.source,
        actor,
        identityKey: mcpIdentityKey(context.source, context.clientId, context.controllerInstanceId, actor),
        ...(context.clientId ? { clientId: context.clientId } : {}),
        ...(context.controllerInstanceId ? { controllerInstanceId: context.controllerInstanceId } : {}),
      })
      return { ok: true, data: result }
    },
  }
}

export function mcpIdentityKey(
  source: "mcp-http" | "mcp-stdio",
  clientId: string | undefined,
  controllerInstanceId: string | undefined,
  actor: DispatchActorIdentity,
): string {
  if (clientId && controllerInstanceId) {
    return `${source}\u0000client\u0000${clientId}\u0000controller\u0000${controllerInstanceId}`
  }
  if (clientId) return `${source}\u0000client\u0000${clientId}`
  if ("id" in actor && actor.id) return `${source}\u0000actor\u0000${actor.kind}\u0000${actor.id}`
  return `${source}\u0000anonymous`
}
