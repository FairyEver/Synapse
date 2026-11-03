import { describe, expect, it, vi } from "vitest"
import { GAME_TOOLS } from "@synapse/shared/game-contracts"
import type { AccountService } from "../../../../electron/services/account-service"
import { GameHallService } from "../service"
import { gameResponseFixtures, hallResponse, tableResponse } from "./response-fixtures"

function serviceFor(body: unknown, status = 200) {
  return serviceFromResponse(Response.json(body, { status }))
}
function serviceFromResponse(response: Response) {
  return new GameHallService({
    getState: () => ({ status: "authenticated", profile: { user: { id: "user" } } }),
    onBeforeIdentityChange: () => () => {},
    fetchAuthenticated: async () => response,
  } as unknown as AccountService)
}
describe("游戏云响应协议", () => {
  it("损坏JSON包含私密片段时只返回安全的协议错误", async () => {
    const service = serviceFromResponse(new Response('{"persona":"不应回显的私密片段" broken'))
    try {
      const error = await service
        .call("app.game.hall.overview", {})
        .catch((error: unknown) => error)
      expect(error).toMatchObject({ code: "GAME_INVALID_RESPONSE", details: {} })
      expect(String(error)).not.toContain("不应回显的私密片段")
    } finally {
      service.dispose()
    }
  })
  it("JSON读取同时取消并解析失败时保留原始取消原因", async () => {
    const controller = new AbortController(),
      reason = new Error("原始取消原因")
    const response = new Response()
    vi.spyOn(response, "json").mockImplementation(() => {
      controller.abort(reason)
      return Promise.reject(new SyntaxError("不能替代取消原因"))
    })
    const service = serviceFromResponse(response)
    try {
      await expect(service.call("app.game.hall.overview", {}, controller.signal)).rejects.toBe(
        reason,
      )
    } finally {
      service.dispose()
    }
  })
  it("响应夹具覆盖全部MCP工具及两个私有UI操作", () => {
    expect(Object.keys(gameResponseFixtures).sort()).toEqual(
      [...GAME_TOOLS.map((tool) => tool.id), "app.game.poker.room.close", "app.game.poker.control.set"].sort(),
    )
  })
  it.each([
    {},
    null,
    [],
    { ok: true },
    { ok: true, data: null },
    { ok: "true", data: hallResponse },
  ])("畸形成功信封返回安全错误：%j", async (body) => {
    const service = serviceFor(body)
    try {
      await expect(service.call("app.game.hall.overview", {})).rejects.toMatchObject({
        code: "GAME_INVALID_RESPONSE",
        details: {},
      })
    } finally {
      service.dispose()
    }
  })
  it.each([
    [
      "app.game.hall.overview",
      { ...hallResponse, points: { ...hallResponse.points, total: "私密原始载荷" } },
    ],
    ["app.game.hall.overview", { ...hallResponse, sessions: [null] }],
    ["app.game.poker.table.state", { ...tableResponse, board: {} }],
    [
      "app.game.poker.table.state",
      { ...tableResponse, seats: [{ ...tableResponse.seats[0], stack: "私密原始载荷" }] },
    ],
    [
      "app.game.poker.stats.get",
      { hands: 1, netProfit: 0, vpip: 0, pfr: 0, aggression: "私密原始载荷", winRate: 0 },
    ],
    ["app.game.poker.hand.history", { items: [null], nextOffset: null }],
    [
      "app.game.poker.agent.versions",
      [{ id: "version", versionNo: 1, persona: "私密原始载荷", handCount: "0" }],
    ],
  ])("%s拒绝损坏的消费字段且不回显数据", async (operation, data) => {
    const service = serviceFor({ ok: true, data })
    try {
      const error = await service.call(operation as string, {}).catch((error: unknown) => error)
      expect(error).toMatchObject({ code: "GAME_INVALID_RESPONSE", details: {} })
      expect(String(error)).not.toContain("私密原始载荷")
    } finally {
      service.dispose()
    }
  })
  it.each(Object.entries(gameResponseFixtures))(
    "%s保留真实成功响应及未来附加字段",
    async (operation, fixture) => {
      const data = Array.isArray(fixture)
        ? fixture.map((item) => ({ ...item, futureField: "兼容扩展" }))
        : { ...(fixture as object), futureField: "兼容扩展" }
      const ui = ["app.game.poker.room.close", "app.game.poker.control.set"].includes(operation)
      const service = serviceFor(ui ? data : { ok: true, data, futureEnvelope: true })
      try {
        expect(
          await (ui ? service.callFromUi(operation, {}) : service.call(operation, {})),
        ).toEqual(data)
      } finally {
        service.dispose()
      }
    },
  )
  it("桌面state保留bare传输及嵌套对象扩展", async () => {
    const data = {
      ...tableResponse,
      seats: tableResponse.seats.map((seat) => ({ ...seat, futureSeat: true })),
      recentActions: tableResponse.recentActions.map((action) => ({
        ...action,
        personaVersion: { ...action.personaVersion, futureVersion: true },
      })),
    }
    const service = serviceFor(data)
    try {
      expect(await service.callFromUi("app.game.poker.table.state", { roomCode: "4821" })).toEqual(
        data,
      )
    } finally {
      service.dispose()
    }
  })
  it.each([
    {
      status: "your_turn",
      handId: "hand",
      handNo: 1,
      street: "preflop",
      board: [],
      hole: ["As", "Kh"],
      pot: 4,
      toCall: 2,
      minRaiseTo: 4,
      maxRaiseTo: 1000,
      streetBets: { 0: 1, 1: 2 },
      seats: tableResponse.seats,
      recentActions: tableResponse.recentActions,
      persona: "风格",
      legalActions: ["fold", "call"],
      deadlineMs: 600000,
      cursor: "1:1",
    },
    {
      status: "hand_result",
      handNo: 1,
      result: "won",
      delta: 2,
      stack: 1002,
      cursor: "1:2147483647",
    },
    {
      status: "table_closed",
      cursor: "1:1",
      lastAutoAction: { handNo: 1, action: "fold", reason: "timeout" },
    },
  ])("wait正常%s报文保持原状", async (data) => {
    const service = serviceFor({ ok: true, data })
    try {
      expect(await service.call("app.game.poker.table.wait", {})).toEqual(data)
    } finally {
      service.dispose()
    }
  })
  it("立即解散的bare响应保持closed确认", async () => {
    const service = serviceFor({ closed: true })
    try {
      expect(await service.callFromUi("app.game.poker.room.close", {})).toEqual({ closed: true })
    } finally {
      service.dispose()
    }
  })
  it.each([200, 400])("HTTP %s业务错误保留错误码和合法行动提示", async (status) => {
    const failure = {
      code: "POKER_ILLEGAL_ACTION",
      message: "数额无效",
      legalActions: ["call"],
      toCall: 2,
    }
    const service = serviceFor(status === 200 ? { ok: false, failure } : failure, status)
    try {
      await expect(service.call("app.game.poker.action.act", {})).rejects.toMatchObject({
        code: failure.code,
        details: failure,
      })
    } finally {
      service.dispose()
    }
  })
})
