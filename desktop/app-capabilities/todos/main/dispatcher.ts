import type { DispatchContext, DispatchResult } from "../../../synapse-capabilities/shared/types"
import type { AuditSink, PermissionGuard } from "../../../electron/runtime/security"
import { checkCapabilityPermission } from "../../../electron/capabilities/permission-audit"
import { TodoCloudError, todoFailure } from "../shared/ipc-result"
import { todoCompletionActionSchema, todoCreateInputSchema, todoDeleteActionSchema, todoListInputSchema, todoLocatorSchema, todoUpdateActionSchema } from "../shared/schema"
import type { TodoCloudService } from "./service"

function operation(service: TodoCloudService, action: string, params: Record<string, unknown>): { run: () => Promise<unknown>; id?: string; expectedVersion?: number } {
  switch (action) {
    case "app.todos.item.list": { const input = todoListInputSchema.parse(params); return { run: () => service.list(input) } }
    case "app.todos.item.get": { const input = todoLocatorSchema.parse(params); return { id: input.id, run: () => service.get(input as Parameters<TodoCloudService["get"]>[0]) } }
    case "app.todos.item.create": { const input = todoCreateInputSchema.parse(params); return { run: () => service.create(input) } }
    case "app.todos.item.update": { const { id, ...input } = todoUpdateActionSchema.parse(params); return { id, expectedVersion: input.expectedVersion, run: () => service.update(id, input) } }
    case "app.todos.item.set_completed": { const { id, ...input } = todoCompletionActionSchema.parse(params); return { id, expectedVersion: input.expectedVersion, run: () => service.setCompleted(id, input) } }
    case "app.todos.item.delete": { const { id, ...input } = todoDeleteActionSchema.parse(params); return { id, expectedVersion: input.expectedVersion, run: () => service.delete(id, input) } }
    default: throw new Error("Unknown Todo operation")
  }
}
export function createTodoCapabilityDispatcher(deps: { service: TodoCloudService; permissionGuard?: PermissionGuard; auditSink?: AuditSink }) {
  return {
    async dispatch(action: string, params: Record<string, unknown>, context: DispatchContext): Promise<DispatchResult> {
      const selected = operation(deps.service, action, params)
      const actor = context.actor ?? { kind: "user" as const, id: "synapse-mcp", display: "Synapse MCP" }
      const metadata = { action, source: context.source ?? "api", id: selected.id, expectedVersion: selected.expectedVersion }
      const permission = await checkCapabilityPermission({ permissionGuard: deps.permissionGuard, auditSink: deps.auditSink, action: "network.connect", actor, resource: "synapse-todos", context: metadata })
      if (permission && !permission.allowed) {
        deps.auditSink?.record({ action: "network.connect", actor, resource: "synapse-todos", outcome: "denied", metadata })
        throw new TodoCloudError(403, "TODO_PERMISSION_DENIED", permission.reason)
      }
      try {
        const data = await selected.run()
        deps.auditSink?.record({ action: "network.connect", actor, resource: "synapse-todos", outcome: "allowed", metadata })
        return { ok: true, data }
      } catch (error) {
        const failure = todoFailure(error)
        deps.auditSink?.record({ action: "network.connect", actor, resource: "synapse-todos", outcome: "failed", metadata: { ...metadata, status: failure.status, code: failure.code } })
        return { ok: false, code: failure.code, error: failure.message, data: { status: failure.status } }
      }
    },
  }
}
