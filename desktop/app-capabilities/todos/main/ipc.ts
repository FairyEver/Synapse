import { z } from "zod"
import type { IpcModule, IpcMethodDescriptor } from "../../../electron/runtime/ipc/types"
import type { AuditSink, PermissionGuard } from "../../../electron/runtime/security"
import { TODOS_SERVICE_ID } from "../shared/capability"
import { todoFailure } from "../shared/ipc-result"
import { todoCompletionActionSchema, todoCreateInputSchema, todoDeleteActionSchema, todoDeleteResultSchema, todoIpcResultSchema, todoItemSchema, todoListInputSchema, todoLocatorSchema, todoPageSchema, todoUpdateActionSchema } from "../shared/schema"
import type { TodoCloudService } from "./service"
import { createTodoCapabilityDispatcher } from "./dispatcher"

function method(action: string, request: z.ZodType, result: z.ZodType): IpcMethodDescriptor {
  return {
    operationId: action as IpcMethodDescriptor["operationId"], kind: "invoke", request, response: todoIpcResultSchema(result),
    async handler(ctx, input) {
      try {
        const dispatcher = createTodoCapabilityDispatcher({ service: ctx.resolve<TodoCloudService>(TODOS_SERVICE_ID),
          permissionGuard: ctx.resolve<PermissionGuard>("core.permission-guard"), auditSink: ctx.resolve<AuditSink>("core.audit-sink") })
        const response = await dispatcher.dispatch(action, input as Record<string, unknown>, { source: "api", actor: { kind: "user", id: "todos-app" } })
        return response.ok ? { ok: true, data: response.data } : { ok: false, failure: { status: (response.data as { status: number }).status, code: response.code, message: response.error } }
      } catch (error) { return { ok: false, failure: todoFailure(error) } }
    },
  }
}
export const todosIpcModule: IpcModule = {
  id: "todos",
  methods: {
    list: { ...method("app.todos.item.list", todoListInputSchema, todoPageSchema), operationId: "app.todos.item.list" },
    get: { ...method("app.todos.item.get", todoLocatorSchema, todoItemSchema), operationId: "app.todos.item.get" },
    create: { ...method("app.todos.item.create", todoCreateInputSchema, todoItemSchema), operationId: "app.todos.item.create" },
    update: { ...method("app.todos.item.update", todoUpdateActionSchema, todoItemSchema), operationId: "app.todos.item.update" },
    setCompleted: { ...method("app.todos.item.set_completed", todoCompletionActionSchema, todoItemSchema), operationId: "app.todos.item.set_completed" },
    delete: { ...method("app.todos.item.delete", todoDeleteActionSchema, todoDeleteResultSchema), operationId: "app.todos.item.delete" },
  },
  events: {},
}
