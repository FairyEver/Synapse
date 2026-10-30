import { GAME_UI_ROUTES } from "./ui-routes"
import { GAME_TOOLS } from "@synapse/shared/game-contracts"
import type { AccountService } from "../../../electron/services/account-service"
import { GAME_UI_OPERATIONS } from "../shared/capability"
export class GameCloudError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message)
  }
}
export class GameHallService {
  private generation = 0
  private readonly requests = new Set<AbortController>()
  private readonly unsubscribe: () => void
  constructor(
    private readonly account: Pick<
      AccountService,
      "fetchAuthenticated" | "getState" | "onBeforeIdentityChange"
    >,
  ) {
    this.unsubscribe = account.onBeforeIdentityChange(() => {
      this.generation++
      for (const request of this.requests) request.abort()
    })
  }
  dispose() {
    this.unsubscribe()
    this.generation++
    for (const request of this.requests) request.abort()
    this.requests.clear()
  }
  captureIdentityGuard(): () => void {
    const state = this.account.getState()
    if (state.status !== "authenticated")
      throw new GameCloudError("GAME_AUTH_REQUIRED", "请先登录。")
    const generation = this.generation,
      identity = state.profile.user.id
    return () => {
      const now = this.account.getState()
      if (
        this.generation !== generation ||
        now.status !== "authenticated" ||
        now.profile.user.id !== identity
      )
        throw new GameCloudError("GAME_IDENTITY_CHANGED", "账号已变更。")
    }
  }
  async callFromUi(operation: string, params: Record<string, unknown>): Promise<unknown> {
    if (!GAME_UI_OPERATIONS.some((t) => t.id === operation))
      throw new GameCloudError("POKER_ILLEGAL_ACTION", "桌面不提供出牌或入座操作。")
    return this.call(operation, params, undefined, true)
  }
  async call(
    operation: string,
    params: Record<string, unknown>,
    signal?: AbortSignal,
    ui = false,
  ): Promise<unknown> {
    if (
      !GAME_TOOLS.some((t) => t.id === operation) &&
      !(ui && GAME_UI_OPERATIONS.some((t) => t.id === operation))
    )
      throw new GameCloudError("POKER_ILLEGAL_ACTION", "未知游戏操作。")
    const current = this.captureIdentityGuard()
    const controller = new AbortController(),
      abort = () => controller.abort(signal?.reason)
    signal?.addEventListener("abort", abort, { once: true })
    if (signal?.aborted) abort()
    this.requests.add(controller)
    const timer = setTimeout(() => controller.abort(), 30000)
    try {
      const route = ui ? GAME_UI_ROUTES[operation] : undefined
      const path = route ? route.path(params) : "/game/invoke"
      const response = await this.account.fetchAuthenticated(
        path,
        route?.method === "GET"
          ? { signal: controller.signal }
          : {
              method: "POST",
              signal: controller.signal,
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ operation, params }),
            },
        "游戏请求失败。",
      )
      current()
      const body = (await response.json()) as Record<string, unknown>
      current()
      if (!response.ok || body.ok === false) {
        const failure = (body.failure ?? body) as Record<string, unknown>
        throw new GameCloudError(
          String(failure.code ?? "GAME_REQUEST_FAILED"),
          String(failure.message ?? "游戏请求失败。"),
          failure,
        )
      }
      return route?.bareResponse ? body : body.ok === true ? body.data : body
    } catch (error) {
      current()
      throw error
    } finally {
      clearTimeout(timer)
      this.requests.delete(controller)
      signal?.removeEventListener("abort", abort)
    }
  }
}
