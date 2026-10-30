import { describe, expect, it, vi } from "vitest"
import { GameController } from "../game.controller"
import { GameApiService } from "../game-api.service"

describe("扑克UI入口与MCP来源", () => {
  const req = { user: { id: "owner" } } as never
  it("UI信封解包但来源由REST入口固定，不能由body提供", async () => {
    const api = { run: vi.fn().mockResolvedValue({ ok: true }) }
    const controller = new GameController(api as never, {} as never, {} as never, {} as never)
    await controller.action(req, "1234", { operation: "app.game.poker.action.act", params: { action: "call", controlVersion: 2 } })
    expect(api.run).toHaveBeenCalledWith("owner", "app.game.poker.action.act", { roomCode: "1234", action: "call", controlVersion: 2 }, undefined, "human")
    expect(() => controller.action(req, "1234", { operation: "app.game.poker.control.claim", params: {} })).toThrow()
  })
  it("MCP请求不能通过额外controller/source字段冒充真人", async () => {
    const api = new GameApiService({} as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never)
    await expect(api.run("owner", "app.game.poker.seat.join", { roomCode: "1234", controller: "human" })).rejects.toThrow()
    await expect(api.run("owner", "app.game.poker.action.act", { roomCode: "1234", handId: "hand", street: "preflop", action: "call", actionId: "7dab7c7a-142c-43bd-9347-9167dfed541d", source: "human" })).rejects.toThrow()
  })
  it("桌面state使用教学投影、带身份心跳；事件入口不复用MCP决策投影", async () => {
    const state = vi.fn(), events = vi.fn()
    const controller = new GameController({} as never, { state } as never, {} as never, { events } as never)
    await controller.state(req, "1234", "public")
    expect(state).toHaveBeenCalledWith("owner", "1234", "public", true, expect.any(Date), "desktop")
    await controller.tableEvents(req, "1234", "1:1", "10")
    expect(events).toHaveBeenCalledWith("owner", "1234", "1:1", 10, "desktop", "public")
    await controller.tableEvents(req, "1234", "1:1", "10", "owner")
    expect(events).toHaveBeenLastCalledWith("owner", "1234", "1:1", 10, "desktop", "owner")
  })
})
