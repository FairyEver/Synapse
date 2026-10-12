import { randomUUID } from "node:crypto"
import { parseTodoReference } from "@synapse/shared/todo-contracts"
import { TODOS_OPEN_HANDLER } from "../../app-capabilities/todos/shared/manifest"
import { SYSTEM_APP_WINDOW_SERVICE_ID, type createDefaultSystemAppWindowService } from "../services/system-app-window-service"
export function createTodosProtocolHandlers(registry: { get<T>(id: string): T }) {
  return { async [TODOS_OPEN_HANDLER](params: Record<string, unknown>): Promise<void> {
    const id = typeof params.deepLink === "string" ? parseTodoReference(params.deepLink) : null
    if (!id) throw new Error("待办链接无效")
    await registry.get<ReturnType<typeof createDefaultSystemAppWindowService>>(SYSTEM_APP_WINDOW_SERVICE_ID).open("todos", { todoOpenRequest: { requestId: randomUUID(), id } })
  } }
}
