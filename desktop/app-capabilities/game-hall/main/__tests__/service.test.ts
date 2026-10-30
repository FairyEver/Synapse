import { readFileSync } from "node:fs"
import { describe, expect, it, vi } from "vitest"
import { GameHallService } from "../service"
import type { AccountService } from "../../../../electron/services/account-service"
describe("游戏账号网络边界", () => {
  it("大厅网络代理不包含具体游戏的路由分支", () => {
    const source = readFileSync(new URL("../service.ts", import.meta.url), "utf8")
    expect(source).not.toMatch(/app\.game\.poker|\/game\/poker/)
  })
  it("账号切换丢弃旧响应且取消请求，act不允许从桌面IPC调用", async () => {
    let before = () => {}
    let resolve!: (value: Response) => void
    const fetch = vi.fn(
      () =>
        new Promise<Response>((r) => {
          resolve = r
        }),
    )
    const account = {
      getState: () => ({
        status: "authenticated",
        connectivity: "online",
        profile: { user: { id: "u" } },
      }),
      onBeforeIdentityChange: (fn: () => void) => {
        before = fn
        return () => {}
      },
      fetchAuthenticated: fetch,
    } as unknown as AccountService
    const service = new GameHallService(account)
    const promise = service.call("app.game.hall.overview", {})
    before()
    resolve(new Response("{}"))
    await expect(promise).rejects.toThrow("账号已变更")
    await expect(service.callFromUi("app.game.poker.action.act", {})).rejects.toThrow()
    service.dispose()
  })
  it("服务端可行动的错误码和合法动作保留给AI", async () => {
    const account = {
      getState: () => ({
        status: "authenticated",
        connectivity: "online",
        profile: { user: { id: "u" } },
      }),
      onBeforeIdentityChange: () => () => {},
      fetchAuthenticated: async () =>
        new Response(
          JSON.stringify({
            code: "POKER_ILLEGAL_ACTION",
            message: "数额无效",
            legalActions: ["call"],
            toCall: 2,
          }),
          { status: 400 },
        ),
    } as unknown as AccountService
    const s = new GameHallService(account)
    await expect(s.call("app.game.hall.overview", {})).rejects.toMatchObject({
      code: "POKER_ILLEGAL_ACTION",
      details: { toCall: 2 },
    })
    s.dispose()
  })
  it("房主解散走专用UI入口，仍不暴露出牌能力", async () => {
    const fetch = vi.fn(
      async (_path: string, _init: RequestInit, _message: string) =>
        new Response(JSON.stringify({ pending: true })),
    )
    const account = {
      getState: () => ({
        status: "authenticated",
        connectivity: "online",
        profile: { user: { id: "u" } },
      }),
      onBeforeIdentityChange: () => () => {},
      fetchAuthenticated: fetch,
    } as unknown as AccountService
    const service = new GameHallService(account)
    await expect(
      service.callFromUi("app.game.poker.room.close", { roomCode: "1234" }),
    ).resolves.toEqual({ pending: true })
    expect(fetch.mock.calls[0]?.[0]).toBe("/game/poker/rooms/1234/close")
    service.dispose()
  })
})
