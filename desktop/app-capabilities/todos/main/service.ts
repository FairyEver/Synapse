import { z } from "zod"
import { parseTodoReference, TODO_PRIORITY_HEADER, type TodoCompletionInput, type TodoCreateInput, type TodoDeleteInput, type TodoDeleteResult, type TodoItemDto, type TodoListInput, type TodoLocator, type TodoPageDto, type TodoUpdateInput } from "@synapse/shared/todo-contracts"
import { TODO_IMAGES_HEADER, TODO_MAX_IMAGE_BYTES, TODO_MAX_THUMBNAIL_BYTES, TODO_THUMBNAIL_SIZE_HEADER, type TodoImageReadInput, type TodoImageStageInput } from "@synapse/shared/todo-contracts"
import type { AccountService } from "../../../electron/services/account-service"
import type { EventBus } from "../../../electron/runtime/event-bus/types"
import { TodoCloudError } from "../shared/ipc-result"
import { todoCompletionInputSchema, todoCreateInputSchema, todoDeleteInputSchema, todoDeleteResultSchema, todoIdSchema, todoItemSchema, todoListInputSchema, todoLocatorSchema, todoPageSchema, todoUpdateInputSchema } from "../shared/schema"
import { todoImageContentSchema, todoImageReadSchema, todoImageStageResultSchema, todoImageStageSchema } from "../shared/schema"

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
  stageImage(raw: TodoImageStageInput) {
    const input = todoImageStageSchema.parse(raw)
    const body = Buffer.concat([input.original, input.thumbnail])
    return this.exchange(`/todos/images/${input.imageId}`, {
      method: "PUT", body,
      headers: { "Content-Type": "application/octet-stream", [TODO_THUMBNAIL_SIZE_HEADER]: String(input.thumbnail.byteLength) },
    }, async response => this.decode(todoImageStageResultSchema, await response.json()))
  }
  readImage(raw: TodoImageReadInput) {
    const { todoId, imageId, variant } = todoImageReadSchema.parse(raw)
    return this.exchange(`/todos/${todoId}/images/${imageId}/${variant}`, { method: "GET" }, async response =>
      this.decode(todoImageContentSchema, {
        mimeType: response.headers.get("content-type"),
        bytes: await readImageBytes(response, variant === "thumbnail" ? TODO_MAX_THUMBNAIL_BYTES : TODO_MAX_IMAGE_BYTES),
      }),
    )
  }
  private request<T>(path: string, method: string, input: unknown, schema: z.ZodType<T>, list = false): Promise<T> {
    const headers: Record<string, string> = { [TODO_PRIORITY_HEADER]: "1", [TODO_IMAGES_HEADER]: "1" }
    if (input !== undefined) headers["Content-Type"] = "application/json"
    return this.exchange(path, { method, headers, ...(input === undefined ? {} : { body: JSON.stringify(input) }) },
      async response => this.decode(schema, await response.json()), list)
  }
  private decode<T>(schema: z.ZodType<T>, data: unknown): T {
    const result = schema.safeParse(data)
    if (!result.success) throw new TodoCloudError(0, "TODO_BAD_RESPONSE", "待办数据无法读取，请重试")
    return result.data
  }
  private async exchange<T>(path: string, init: RequestInit, decode: (response: Response) => Promise<T>, list = false): Promise<T> {
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
      const response = await this.deps.account.fetchAuthenticated(path, { ...init, signal: controller.signal }, "待办请求失败")
      current()
      const result = await decode(response)
      current()
      return result
    } catch (error) {
      current()
      if (error instanceof TodoCloudError) throw error
      const failure = error as { status?: number; code?: string }
      const status = typeof failure?.status === "number" ? failure.status : 0
      const code = status === 404 ? (list ? "TODO_SERVER_UNSUPPORTED" : path.includes("/images/") ? "TODO_IMAGE_UNAVAILABLE" : "TODO_UNAVAILABLE")
        : failure.code ?? (status === 401 || status === 403 ? "TODO_AUTH_REQUIRED" : "TODO_NETWORK_ERROR")
      const messages: Record<string, string> = { TODO_SERVER_UNSUPPORTED: "服务器尚不支持待办事项，请升级服务器", TODO_UNAVAILABLE: "事项已删除或无法访问",
        TODO_VERSION_CONFLICT: "事项已被修改，请重新载入", TODO_REQUEST_CONFLICT: "请求标识已用于其他操作",
        TODO_REMINDER_IN_PAST: "提醒时间必须晚于当前时间", TODO_INVALID_REMINDER: "请补齐截止时间和提醒选项", TODO_AUTH_REQUIRED: "请先登录",
        TODO_IMAGE_UNAVAILABLE: "图片已失效或无法访问，请重新添加", TODO_IMAGE_FORMAT: "图片格式不支持或无法读取",
        TODO_IMAGE_UPLOAD_FAILED: "图片上传失败，请重试",
        TODO_IMAGE_PENDING_LIMIT: "待保存的图片过多，请稍后重试", TODO_IMAGE_CONFLICT: "图片已变更，请重新添加" }
      throw new TodoCloudError(status, code, messages[code] ?? (status === 400 ? "待办内容无效，请检查后重试" : "连接失败，请重试"))
    } finally { clearTimeout(timer); this.requests.delete(controller) }
  }
}

async function readImageBytes(response: Response, limit: number): Promise<Uint8Array> {
  const reader = response.body?.getReader()
  if (!reader) throw new TodoCloudError(0, "TODO_BAD_RESPONSE", "图片无法读取")
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > limit) {
        await reader.cancel()
        throw new TodoCloudError(0, "TODO_BAD_RESPONSE", "图片超过大小限制")
      }
      chunks.push(value)
    }
    return new Uint8Array(Buffer.concat(chunks, size))
  } finally { reader.releaseLock() }
}
