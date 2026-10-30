import { describe, expect, it, vi } from "vitest"
import type { AccountService } from "../../../../electron/services/account-service"
import type { AuditSink, PermissionGuard } from "../../../../electron/runtime/security"
import { createGameDispatcher } from "../dispatcher"
import { GameHallService } from "../service"

describe("游戏权限等待期间的账号隔离", () => {
  it.each(["switch", "same-account-relogin", "dispose"])(
    "%s 后不将原账号的请求交给后来的身份",
    async (mode) => {
      let userId = "first",
        before = () => {}
      let allow!: (result: { allowed: true }) => void
      const permission = new Promise<{ allowed: true }>((resolve) => {
        allow = resolve
      })
      const fetch = vi.fn(
        async () => new Response(JSON.stringify({ ok: true, data: { id: "saved" } })),
      )
      const account = {
        getState: () => ({
          status: "authenticated",
          connectivity: "online",
          profile: { user: { id: userId } },
        }),
        onBeforeIdentityChange: (listener: () => void) => {
          before = listener
          return () => {}
        },
        fetchAuthenticated: fetch,
      } as unknown as AccountService
      const service = new GameHallService(account)
      const dispatcher = createGameDispatcher({
        service,
        permissionGuard: { check: () => permission } as unknown as PermissionGuard,
        auditSink: { record: vi.fn() } as unknown as AuditSink,
      })
      const pending = dispatcher.dispatch(
        "app.game.poker.agent.upsert",
        { persona: "首个账号的私密提示词" },
        { source: "mcp-stdio" },
      )
      if (mode === "dispose") service.dispose()
      else {
        before()
        userId = mode === "switch" ? "second" : "first"
      }
      allow({ allowed: true })
      expect(await pending).toMatchObject({ ok: false, code: "GAME_IDENTITY_CHANGED" })
      expect(fetch).not.toHaveBeenCalled()
      service.dispose()
    },
  )
  it("身份未变化时权限通过后正常执行一次", async () => {
    const fetch = vi.fn(
      async () => new Response(JSON.stringify({ ok: true, data: { id: "saved" } })),
    )
    const service = new GameHallService({
      getState: () => ({
        status: "authenticated",
        connectivity: "online",
        profile: { user: { id: "first" } },
      }),
      onBeforeIdentityChange: () => () => {},
      fetchAuthenticated: fetch,
    } as unknown as AccountService)
    const dispatcher = createGameDispatcher({
      service,
      permissionGuard: { check: async () => ({ allowed: true }) } as unknown as PermissionGuard,
      auditSink: { record: vi.fn() } as unknown as AuditSink,
    })
    expect(
      await dispatcher.dispatch(
        "app.game.poker.agent.upsert",
        { persona: "私密提示词" },
        { source: "mcp-stdio" },
      ),
    ).toEqual({ ok: true, data: { id: "saved" } })
    expect(fetch).toHaveBeenCalledOnce()
    service.dispose()
  })
})
