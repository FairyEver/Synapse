import { abortable } from "./abortable"
import { GAME_RESPONSE_SCHEMAS, GAME_UI_OPERATIONS, GAME_UI_ROUTES, GAME_WEB_IDENTITY_HEADER } from "@synapse/shared/game-ui"
import { ApiError, requestJson } from "@/lib/api-client"

export class GameWebError extends Error {
  constructor(readonly code: string, message: string, readonly details: Record<string, unknown> = {}) { super(message) }
}
const invalidResponse = () => new GameWebError("GAME_INVALID_RESPONSE", "游戏响应格式无效，请重试。")
const identityChanged = () => new GameWebError("GAME_IDENTITY_CHANGED", "登录账号已变更，请重新载入。")

export class GameWebClient {
  private requests = new Set<AbortController>()
  private generation = 0
  constructor(private readonly options: { getIdentity: () => string | null; onSessionInvalid: () => void }) {}
  identityChanged() {
    this.generation++
    for (const request of this.requests) request.abort(identityChanged())
    this.requests.clear()
  }
  dispose() { this.identityChanged() }
  async call(operation: string, params: Record<string, unknown>, signal?: AbortSignal): Promise<unknown> {
    if (!GAME_UI_OPERATIONS.some(t => t.id === operation)) throw new GameWebError("GAME_UNKNOWN_OPERATION", "未知游戏操作。")
    const identity = this.options.getIdentity(), generation = this.generation
    if (!identity) throw new GameWebError("GAME_AUTH_REQUIRED", "请先登录。")
    const controller = new AbortController(), cancel = () => controller.abort(signal?.reason)
    signal?.addEventListener("abort", cancel, { once: true })
    if (signal?.aborted) cancel()
    const current = () => {
      if (generation !== this.generation || this.options.getIdentity() !== identity) throw identityChanged()
      controller.signal.throwIfAborted()
    }
    this.requests.add(controller)
    const timer = setTimeout(() => controller.abort(new DOMException("游戏请求超时，请重试。", "AbortError")), 30_000)
    try {
      const route = GAME_UI_ROUTES[operation]
      let body: unknown
      try {
        body = await abortable(controller.signal, () => requestJson<unknown>(`/api${route ? route.path(params) : "/game/invoke"}`, {
          method: route?.method ?? "POST", signal: controller.signal,
          headers: { [GAME_WEB_IDENTITY_HEADER]: identity },
          ...(route?.method === "GET" ? {} : { body: JSON.stringify({ operation, params }) }),
        }))
      } catch (error) {
        current()
        if (error instanceof ApiError) {
          if (error.status === 401 || error.code === "GAME_IDENTITY_CHANGED") this.options.onSessionInvalid()
          throw new GameWebError(error.code ?? "GAME_REQUEST_FAILED", error.message, error.details)
        }
        if (error instanceof SyntaxError) throw invalidResponse()
        throw error
      }
      current()
      const record = body && typeof body === "object" && !Array.isArray(body) ? body as Record<string, unknown> : null
      if (record?.ok === false) {
        const failure = record.failure && typeof record.failure === "object" ? record.failure as Record<string, unknown> : {}
        throw new GameWebError(String(failure.code ?? "GAME_REQUEST_FAILED"), String(failure.message ?? "游戏请求失败。"), failure)
      }
      if (!route && (record?.ok !== true || record.data == null)) throw invalidResponse()
      const parsed = GAME_RESPONSE_SCHEMAS[operation]?.safeParse(route ? body : record!.data)
      if (!parsed?.success) throw invalidResponse()
      return parsed.data
    } finally {
      clearTimeout(timer)
      this.requests.delete(controller)
      signal?.removeEventListener("abort", cancel)
    }
  }
}
