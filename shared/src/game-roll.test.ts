import { z } from "zod"
import { describe, expect, it } from "vitest"
import { GAME_TOOLS } from "./game.js"
import { GAME_RESPONSE_SCHEMAS } from "./game-response-schemas.js"
import { GAME_UI_ROUTES } from "./game-ui.js"
describe("Roll线协议", () => {
  it("start与choose要求完整并发、控制与幂等字段并走窄UI路由", () => {
    for (const op of ["start", "choose"]) {
      const tool = GAME_TOOLS.find(t => t.id === `app.game.poker.roll.${op}`)!
      expect(tool).toBeDefined()
      expect(tool.inputSchema.required).toEqual(Object.keys(tool.inputSchema.properties).filter(key => key !== "expectedPaymentVersion"))
      expect(GAME_UI_ROUTES[tool.id].path({ roomCode: "1234" })).toBe(`/game/poker/rooms/1234/roll/${op}`)
      expect(GAME_RESPONSE_SCHEMAS[tool.id].safeParse({ ok: true, handId: "h", rollId: "r", actionSeq: 2, cursor: "1:2", status: "choice_required" }).success).toBe(true)
      expect(GAME_RESPONSE_SCHEMAS[tool.id].safeParse({ ok: true, handId: "h" }).success).toBe(false)
    }
  })
  it("输入拒绝缺字段、越界候选及客户端费率版本", () => {
    const start = GAME_TOOLS.find(t => t.id === "app.game.poker.roll.start")!, choose = GAME_TOOLS.find(t => t.id === "app.game.poker.roll.choose")!
    const parse = (tool: typeof start) => z.fromJSONSchema(tool.inputSchema as Parameters<typeof z.fromJSONSchema>[0])
    const base = { roomCode: "1234", handId: "h", street: "flop", expectedActionSeq: 2, controlVersion: 1, actionId: "c31f8452-0886-414f-b266-03ea3318a30e", kind: "super", cardIndex: 1, expectedFee: 8 }
    expect(parse(start).safeParse(base).success).toBe(true)
    for (const key of Object.keys(base)) { const bad: Record<string, unknown> = { ...base }; delete bad[key]; expect(parse(start).safeParse(bad).success).toBe(false) }
    for (const bad of [{ cardIndex: 2 }, { expectedFee: 0 }, { street: "river" }, { actionId: "not-uuid" }, { rollPricingVersion: "custom" }]) expect(parse(start).safeParse({ ...base, ...bad }).success).toBe(false)
    const select = { roomCode: "1234", handId: "h", rollId: "r", expectedActionSeq: 2, controlVersion: 1, actionId: base.actionId, candidateIndex: 2 }
    expect(parse(choose).safeParse(select).success).toBe(true)
    expect(parse(choose).safeParse({ ...select, candidateIndex: 3 }).success).toBe(false)
    const create = parse(GAME_TOOLS.find(t => t.id === "app.game.poker.room.create")!)
    expect(create.safeParse({ maxSeats: 2, buyIn: 1000, ruleOptions: { roll: true } }).success).toBe(true)
    expect(create.safeParse({ maxSeats: 2, buyIn: 1000, ruleOptions: { roll: true, rollCoins: 21 } }).success).toBe(true)
    for (const options of [{roll:true,rollCoins:0},{roll:true,rollCoins:1.5},{roll:true,rollCoins:2147483648},{roll:true,normalCost:2},{roll:true,superCost:4}])
      expect(create.safeParse({ maxSeats:2,buyIn:1000,ruleOptions:options }).success).toBe(false)
    expect(create.safeParse({ maxSeats: 2, buyIn: 1000, ruleOptions: {} }).success).toBe(true)
    expect(create.safeParse({ maxSeats: 2, buyIn: 1000, ruleOptions: { roll: true, rate: 1 } }).success).toBe(false)
  })
  it("公开事件禁止包含私有候选、旧牌及位置", () => {
    const schema = GAME_RESPONSE_SCHEMAS["app.game.poker.table.events"]
    const roll = { kind: "super", phase: "start", fee: 8, count: 1, seatNo: 0, displayName: "a", source: "human", compensations: { 1: 8 } }
    const value = { events: [{ kind: "roll", handId: "h", handNo: 1, seq: 2, roll }], cursor: "1:2", hasMore: false }
    expect(schema.safeParse(value).success).toBe(true)
    for (const field of ["candidates", "oldCard", "cardIndex", "selectedIndex", "originalHoles"]) expect(schema.safeParse({ ...value, events: [{ ...value.events[0], roll: { ...roll, [field]: [] } }] }).success).toBe(false)
  })
  it("校验私有待选必需字段及候选边界", () => {
    const schema = GAME_RESPONSE_SCHEMAS["app.game.poker.table.wait"]
    const value = { status: "roll_choice_required", handId: "h", handNo: 1, rollId: "r", cardIndex: 1, candidates: ["As", "Kh", "Qd"], controlVersion: 1, actionSeq: 2, deadlineMs: 10, cursor: "1:2" }
    expect(schema.safeParse(value).success).toBe(true)
    for (const key of Object.keys(value)) { const bad: Record<string, unknown> = { ...value }; delete bad[key]; expect(schema.safeParse(bad).success).toBe(false) }
    expect(schema.safeParse({ ...value, candidates: ["As"] }).success).toBe(false)
  })
})
