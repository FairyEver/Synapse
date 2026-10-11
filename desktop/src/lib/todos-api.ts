import type { TodoChangedPayload, TodoCompletionInput, TodoCreateInput, TodoDeleteInput, TodoListInput, TodoLocator, TodoUpdateInput } from "@synapse/shared/todo-contracts"
import { getSynapseBridge } from "./electron-bridge"
import { TodoCloudError } from "../../app-capabilities/todos/shared/ipc-result"
function item() {
  const api = getSynapseBridge()?.todos.item
  if (!api) throw new TodoCloudError(0, "TODO_SERVICE_UNAVAILABLE", "待办服务不可用")
  return api
}
export const todosApi = {
  list: (input: TodoListInput = {}) => item().list(input),
  get: (locator: TodoLocator) => item().get(locator),
  create: (input: TodoCreateInput) => item().create(input),
  update: (id: string, input: TodoUpdateInput) => item().update(id, input),
  setCompleted: (id: string, input: TodoCompletionInput) => item().setCompleted(id, input),
  delete: (id: string, input: TodoDeleteInput) => item().delete(id, input),
  onChanged: (listener: (event: TodoChangedPayload) => void) => getSynapseBridge()?.todos.item.onChanged(listener) ?? (() => undefined),
  onReset: (listener: () => void) => getSynapseBridge()?.todos.item.onReset(listener) ?? (() => undefined),
}
