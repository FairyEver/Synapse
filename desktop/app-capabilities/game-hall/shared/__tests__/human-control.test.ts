import { describe, expect, it } from "vitest"
import { GAME_TOOLS } from "@synapse/shared/game-contracts"
import { gameIpcModule } from "../../main/ipc"
import { GAME_RESPONSE_SCHEMAS } from "../response-schemas"
import { pokerUiRoutes } from "../../games/poker/main/ui-routes"
import { z } from "zod"
import { tableResponse } from "../../main/__tests__/response-fixtures"
import { POKER_HUMAN_ACTION_SCHEMA } from "../../games/poker/shared/ui-operations"

const request = (suffix: string) => z.fromJSONSchema(GAME_TOOLS.find(t => t.id === `app.game.poker.${suffix}`)!.inputSchema as Parameters<typeof z.fromJSONSchema>[0])
describe("扑克人工操作和接管协议", () => {
  it("人工入座/操作/接管及事件具有专用UI入口，控制认领和检查点只向Agent开放", () => {
    const ids = Object.values(gameIpcModule.methods).map(m => m.operationId)
    for (const suffix of ["seat.join", "action.act", "control.set", "table.events"]) expect(ids).toContain(`app.game.poker.${suffix}`)
    for (const suffix of ["table.wait", "control.claim", "checkpoint.get", "checkpoint.save"]) expect(ids).not.toContain(`app.game.poker.${suffix}`)
    expect(pokerUiRoutes["app.game.poker.control.set" as keyof typeof pokerUiRoutes]?.path({ roomCode: "1234" })).toBe("/game/poker/rooms/1234/control")
  })
  it("建房允许两种牌组和盲注预设，拒绝请求冒充控制者", () => {
    expect(request("room.create").safeParse({ maxSeats: 6, buyIn: 500, variant: "short32", blindPreset: "5/10" }).success).toBe(true)
    expect(request("room.create").safeParse({ maxSeats: 6, buyIn: 500, blindPreset: "3/6" }).success).toBe(false)
    expect(request("seat.join").safeParse({ roomCode: "1234", controller: "human" }).success).toBe(false)
  })
  it("无座位投影明确区分首次入座和需要重新授权，拒绝损坏授权标记", () => {
    const schema = GAME_RESPONSE_SCHEMAS["app.game.poker.table.state"]!
    for (const requiresJoinApproval of [true, false]) expect(schema.safeParse({ ...tableResponse, mySeatNo: null, requiresJoinApproval }).success).toBe(true)
    expect(schema.safeParse({ ...tableResponse, requiresJoinApproval: "false" }).success).toBe(false)
  })
  it("重新入座可携带当前控制版本且不接受无效版本或冒充来源", () => {
    const join = request("seat.join")
    expect(join.safeParse({ roomCode: "1234" }).success).toBe(true)
    expect(join.safeParse({ roomCode: "1234", controlVersion: 3 }).success).toBe(true)
    for (const controlVersion of [-1, 1.5, "3"]) expect(join.safeParse({ roomCode: "1234", controlVersion }).success).toBe(false)
    expect(join.safeParse({ roomCode: "1234", controlVersion: 3, source: "human" }).success).toBe(false)
    expect(gameIpcModule.methods.pokerSeatJoin.request.safeParse({ roomCode: "1234", controlVersion: 3 }).success).toBe(true)
  })
  it("人工动作拒绝AI私密参数和客户端来源，MCP保留AI参数", () => {
    const human = z.fromJSONSchema(POKER_HUMAN_ACTION_SCHEMA as Parameters<typeof z.fromJSONSchema>[0])
    const input = { roomCode: "1234", handId: "hand", street: "preflop", actionId: "8429bfca-a8e8-4de4-89da-162f516d2f00", action: "fold", controlVersion: 2, expectedActionSeq: 3 }
    expect(human.safeParse(input).success).toBe(true)
    for (const extra of [{ note: "私密判断" }, { personaSource: "session" }, { source: "mcp" }, { controller: "ai" }]) expect(human.safeParse({ ...input, ...extra }).success).toBe(false)
    expect(request("action.act").safeParse({ ...input, note: "私密判断", personaSource: "session" }).success).toBe(true)
  })
  it("事件接口传递本人或公开视角并拒绝非法视角", () => {
    const events = request("table.events")
    for (const perspective of ["owner", "public"]) expect(events.safeParse({ roomCode: "1234", perspective }).success).toBe(true)
    expect(events.safeParse({ roomCode: "1234", perspective: "all" }).success).toBe(false)
    const route = pokerUiRoutes["app.game.poker.table.events"]
    expect(route.path({ roomCode: "1234", perspective: "owner" })).toBe("/game/poker/rooms/1234/events?perspective=owner")
    expect(route.path({ roomCode: "1234" })).toBe("/game/poker/rooms/1234/events?perspective=public")
  })
  it("事件使用有界游标，控制认领和检查点强制校验控制版本", () => {
    expect(request("table.events").safeParse({ roomCode: "1234", cursor: "1:2", limit: 100 }).success).toBe(true)
    expect(request("table.events").safeParse({ roomCode: "1234", limit: 101 }).success).toBe(false)
    expect(request("control.claim").safeParse({ roomCode: "1234" }).success).toBe(false)
    expect(request("checkpoint.save").safeParse({ roomCode: "1234", controlVersion: 2, cursor: "1:2", continueIntent: true }).success).toBe(true)
  })
  it("响应验证拒绝畸形控制结果和事件，接受human动作及control_released", () => {
    const control = GAME_RESPONSE_SCHEMAS["app.game.poker.control.set"]
    expect(control?.safeParse({ controller: "human", controlVersion: 2, handoffPending: false }).success).toBe(true)
    expect(control?.safeParse({ controller: "human", controlVersion: "2", handoffPending: false }).success).toBe(false)
    expect(GAME_RESPONSE_SCHEMAS["app.game.poker.table.events"]?.safeParse({ events: [], cursor: "1:2", hasMore: false }).success).toBe(true)
    expect(GAME_RESPONSE_SCHEMAS["app.game.poker.checkpoint.get"]?.safeParse({ checkpoint: null }).success).toBe(true)
    expect(GAME_RESPONSE_SCHEMAS["app.game.poker.table.wait"]?.safeParse({ status: "control_released", cursor: "1:2" }).success).toBe(true)
    expect(GAME_RESPONSE_SCHEMAS["app.game.poker.table.wait"]?.safeParse({ status: "control_released", cursor: "1:2", controlVersion: "old" }).success).toBe(false)
  })
})
