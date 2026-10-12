import { z } from "zod"
import { parseTodoReference, type TodoCompletionInput, type TodoCreateInput, type TodoDeleteInput, type TodoDeleteResult, type TodoItemDto, type TodoListInput, type TodoLocator, type TodoPageDto, type TodoUpdateInput } from "@synapse/shared/todo-contracts"
import type { AccountService } from "../../../electron/services/account-service"
import type { EventBus } from "../../../electron/runtime/event-bus/types"
import { TodoCloudError } from "../shared/ipc-result"
import { todoCompletionInputSchema, todoCreateInputSchema, todoDeleteInputSchema, todoDeleteResultSchema, todoIdSchema, todoItemSchema, todoListInputSchema, todoLocatorSchema, todoPageSchema, todoUpdateInputSchema } from "../shared/schema"

export type TodoAccountClient = Pick<AccountService, "fetchAuthenticated" | "getState" | "onBeforeIdentityChange">
export class TodoCloudService {
  private generation = 0
  private readonly requests = new Set<AbortController>()
  private readonly unsubscribe: () => void
  constructor(private readonly deps: { account: TodoAccountClient; eventBus?: EventBus }) {
    this.unsubscribe = deps.account.onBeforeIdentityChange(() => {
      this.generation++
      for (const controller of this.requests) controller.abort()
      this.requests.clear()
      deps.eventBus?.emit({ domain: "account", type: "todos.reset", payload: {}, timestamp: new Date().toISOString() })
    })
  }
  dispose(): void { this.unsubscribe(); this.generation++; for (const request of this.requests) request.abort(); this.requests.clear() }
  async list(input: TodoListInput = {}): Promise<TodoPageDto> {
    const parsed = todoListInputSchema.parse(input)
    const query = new URLSearchParams(Object.entries(parsed).filter(([, value]) => value !== undefined).map(([key, value]) => [key, String(value)]))
    return this.request("/todos" + (query.size ? "?" + query : ""), "GET", undefined, todoPageSchema, true)
  }
  async get(locator: TodoLocator): Promise<TodoItemDto> {
    const parsed = todoLocatorSchema.parse(locator)
    const id = parsed.id ?? parseTodoReference(parsed.reference!)!
    return this.request("/todos/" + encodeURIComponent(id), "GET", undefined, todoItemSchema)
  }
  async create(input: TodoCreateInput): Promise<TodoItemDto> { return this.request("/todos", "POST", todoCreateInputSchema.parse(input), todoItemSchema) }
  async update(id: string, input: TodoUpdateInput): Promise<TodoItemDto> { return this.request("/todos/" + todoIdSchema.parse(id), "PATCH", todoUpdateInputSchema.parse(input), todoItemSchema) }
  async setCompleted(id: string, input: TodoCompletionInput): Promise<TodoItemDto> { return this.request("/todos/" + todoIdSchema.parse(id) + "/completion", "PATCH", todoCompletionInputSchema.parse(input), todoItemSchema) }
  async delete(id: string, input: TodoDeleteInput): Promise<TodoDeleteResult> { return this.request("/todos/" + todoIdSchema.parse(id), "DELETE", todoDeleteInputSchema.parse(input), todoDeleteResultSchema) }
  private async request<T>(path: string, method: string, input: unknown, schema: z.ZodType<T>, list = false): Promise<T> {
    const state = this.deps.account.getState()
    if (state.status !== "authenticated") throw new TodoCloudError(401, "TODO_AUTH_REQUIRED", "请先登录")
    if (state.connectivity === "offline") throw new TodoCloudError(0, "TODO_NETWORK_ERROR", "连接失败，请重试")
    const identity = state.profile.user.id, generation = this.generation
    const controller = new AbortController()
    this.requests.add(controller)
    const timer = setTimeout(() => controller.abort(), 30000)
    const current = () => {
      const now = this.deps.account.getState()
      if (generation !== this.generation || now.status !== "authenticated" || now.profile.user.id !== identity) throw new TodoCloudError(0, "TODO_IDENTITY_CHANGED", "账号已变更")
    }
    try {
      const response = await this.deps.account.fetchAuthenticated(path, { method, signal: controller.signal, ...(input === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) }) }, "待办请求失败")
      current()
      const result = schema.safeParse(await response.json())
      current()
      if (!result.success) throw new TodoCloudError(0, "TODO_BAD_RESPONSE", "待办数据无法读取，请重试")
      return result.data
    } catch (error) {
      current()
      if (error instanceof TodoCloudError) throw error
      const failure = error as { status?: number; code?: string }
      const status = typeof failure?.status === "number" ? failure.status : 0
      const code = status === 404 ? (list ? "TODO_SERVER_UNSUPPORTED" : "TODO_UNAVAILABLE") : failure.code ?? (status === 401 || status === 403 ? "TODO_AUTH_REQUIRED" : "TODO_NETWORK_ERROR")
      const messages: Record<string, string> = { TODO_SERVER_UNSUPPORTED: "服务器尚不支持待办事项，请升级服务器", TODO_UNAVAILABLE: "事项已删除或无法访问",
        TODO_VERSION_CONFLICT: "事项已被修改，请重新载入", TODO_REQUEST_CONFLICT: "请求标识已用于其他操作",
        TODO_REMINDER_IN_PAST: "提醒时间必须晚于当前时间", TODO_INVALID_REMINDER: "请补齐截止时间和提醒选项", TODO_AUTH_REQUIRED: "请先登录" }
      throw new TodoCloudError(status, code, messages[code] ?? (status === 400 ? "待办内容无效，请检查后重试" : "连接失败，请重试"))
    } finally { clearTimeout(timer); this.requests.delete(controller) }
  }
}
