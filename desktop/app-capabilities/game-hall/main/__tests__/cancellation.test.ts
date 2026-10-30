import { afterEach, describe, expect, it, vi } from "vitest"
import { GameHallService } from "../service"

vi.mock("electron", () => ({
  app: { isPackaged: false, getPath: () => "/tmp/synapse-game-cancellation-unused" },
  safeStorage: {},
}))
vi.mock("../../../../electron/services/log-store", () => ({
  createMainLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}))
import { AccountService } from "../../../../electron/services/account-service"

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}
const profile = {
  user: { id: "user", email: "user@example.test", handle: "user", status: "active" as const },
  syncedAt: "2026-10-30T00:00:00Z",
}
afterEach(() => vi.useRealTimers())

describe("游戏请求取消边界", () => {
  it.each(["timeout", "cancel", "dispose", "identity"])(
    "真实账号401刷新挂起时%s仍立即结束游戏请求，不补发旧写入",
    async (mode) => {
      vi.useFakeTimers()
      const refreshing = deferred<void>(),
        refreshResponse = deferred<Response>()
      let refreshes = 0,
        gameRequests = 0
      let persisted: Record<string, unknown> = { refreshToken: "initial", lastProfile: profile }
      const fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
        init?.signal?.throwIfAborted()
        if (String(url).endsWith("/auth/refresh")) {
          if (++refreshes === 2) {
            refreshing.resolve()
            return refreshResponse.promise
          }
          return Response.json({ accessToken: "access", refreshToken: "initial" })
        }
        if (String(url).endsWith("/auth/me")) return Response.json({ user: profile.user })
        if (String(url).endsWith("/auth/logout")) return Response.json({})
        gameRequests++
        return new Response("", { status: 401 })
      })
      const account = new AccountService({
        fetch,
        namespace: {
          getSingleton: async () => persisted,
          setSingleton: async (next: Record<string, unknown>) => {
            persisted = next
          },
        } as NonNullable<ConstructorParameters<typeof AccountService>[0]>["namespace"],
      })
      await account.refreshFromStorage()
      expect(account.getState().status).toBe("authenticated")
      const authenticated = vi.spyOn(account, "fetchAuthenticated")
      const service = new GameHallService(account),
        controller = new AbortController()
      let settled = false
      const pending = service
        .call("app.game.poker.agent.upsert", { persona: "旧请求" }, controller.signal)
        .catch((error: unknown) => error)
        .finally(() => {
          settled = true
        })
      await refreshing.promise
      if (mode === "timeout") await vi.advanceTimersByTimeAsync(30000)
      else if (mode === "cancel") controller.abort()
      else if (mode === "dispose") service.dispose()
      else await account.logout()
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
      expect(settled).toBe(true)
      expect(await pending).toBeInstanceOf(Error)
      refreshResponse.resolve(Response.json({ accessToken: "later", refreshToken: "initial" }))
      await expect(authenticated.mock.results[0].value).rejects.toBeInstanceOf(Error)
      expect(gameRequests).toBe(1)
      service.dispose()
    },
  )
  it("响应JSON挂起时取消也立即结束", async () => {
    const bodyStarted = deferred<void>(),
      controller = new AbortController()
    const account = {
      getState: () => ({ status: "authenticated", profile: { user: { id: "user" } } }),
      onBeforeIdentityChange: () => () => {},
      fetchAuthenticated: async () => ({
        ok: true,
        json: () => {
          bodyStarted.resolve()
          return new Promise(() => {})
        },
      }),
    } as unknown as AccountService
    const service = new GameHallService(account)
    let settled = false
    const pending = service
      .call("app.game.hall.overview", {}, controller.signal)
      .catch((error: unknown) => error)
      .finally(() => {
        settled = true
      })
    await bodyStarted.promise
    controller.abort()
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
    expect(settled).toBe(true)
    expect(await pending).toBeInstanceOf(Error)
    service.dispose()
  })
})
