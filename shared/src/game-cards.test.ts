import { describe, expect, it } from "vitest"
import { z } from "zod"
import { GAME_TOOLS } from "./game.js"
import * as ui from "./game-ui.js"
import { GAME_RESPONSE_SCHEMAS } from "./game-response-schemas.js"
import { pokerCardViewSchema } from "./game-poker-card-schemas.js"
import { supportsPokerCardRules } from "./game-poker-cards.js"

const play = { roomCode: "1234", handId: "h", street: "flop", expectedActionSeq: 3, controlVersion: 1, actionId: "c31f8452-0886-414f-b266-03ea3318a30e", expectedPaymentVersion: "q1", instanceId: "card-1", selections: { hole: 0, player: 1 } }
describe("卡牌模式线协议", () => {
  it("材料用途兼容旧定义，消耗和保留按布尔元数据解析", () => {
    const definition = { id: "24", name: "弃旧图新", description: "消耗另一张牌", artId: "v1/24", cost: 0 }
    const view = { enabled: true, version: "cards-v1", definitions: { "24": definition }, used: [], statuses: [] }
    expect(pokerCardViewSchema.safeParse(view).success).toBe(true)
    for (const consumeSelected of [true, false]) expect(pokerCardViewSchema.parse({ ...view, definitions: { "24": { ...definition, consumeSelected } } }).definitions!["24"].consumeSelected).toBe(consumeSelected)
    expect(pokerCardViewSchema.safeParse({ ...view, definitions: { "24": { ...definition, consumeSelected: "false" } } }).success).toBe(false)
  })
  it("新版含五选一及取消配置，且保留旧手解析", () => {
    const definition = { id: "07", name: "五选其一", description: "选择候选", artId: "v1/07", cost: 0, play: { cancelUntil: "never", result: "holes", candidates: 5 } }
    const pending = { choiceId: "c", kind: "poker", origin: "card", paymentVersion: "q", candidates: ["As", "Ks", "Qs", "Js", "Ts"] }
    expect(pokerCardViewSchema.safeParse({ enabled: true, version: "cards-v2", definitions: { "07": definition }, pending, used: [], statuses: [] }).success).toBe(true)
    const choose = ui.POKER_PRIVATE_UI_OPERATIONS.find(t => t.id === "app.game.poker.card.choose")!
    const schema = z.fromJSONSchema(choose.inputSchema as Parameters<typeof z.fromJSONSchema>[0])
    const { instanceId, selections, ...base } = play
    expect(schema.safeParse({ ...base, choiceId: "c", candidateIndex: 4 }).success).toBe(true)
    expect(schema.safeParse({ ...base, choiceId: "c", candidateIndex: 5 }).success).toBe(false)
    expect(supportsPokerCardRules("cards-v1,chips-v2")).toBe(false)
    expect(supportsPokerCardRules("cards-v1,chips-v2", "cards-v1")).toBe(true)
    expect(supportsPokerCardRules("cards-v2,chips-v2")).toBe(false)
    expect(supportsPokerCardRules("cards-v2,chips-v2", "cards-v2")).toBe(true)
    expect(supportsPokerCardRules("cards-v3,chips-v2")).toBe(true)
    expect(pokerCardViewSchema.safeParse({ enabled: true, version: "cards-v3", definitions: { "07": definition }, pending, used: [], statuses: [] }).success).toBe(true)
  })
  it("新房允许卡牌模式且不接受 Roll 或配置卡池", () => {
    const tool = GAME_TOOLS.find(t => t.id === "app.game.poker.room.create")!
    const schema = z.fromJSONSchema(tool.inputSchema as Parameters<typeof z.fromJSONSchema>[0])
    expect(schema.safeParse({ maxSeats: 6, buyIn: 1000, ruleOptions: { cards: true } }).success).toBe(true)
    expect(schema.safeParse({ maxSeats: 6, buyIn: 1000, ruleOptions: { cards: true, roll: true } }).success).toBe(false)
    expect(schema.safeParse({ maxSeats: 6, buyIn: 1000, ruleOptions: { cards: true, copies: 2 } }).success).toBe(false)
    expect(schema.safeParse({ maxSeats: 6, buyIn: 1000 }).success).toBe(true)
  })
  it.each(["play", "choose"])("%s只注册到窄Web路由并验证完整意图", op => {
    const id = `app.game.poker.card.${op}`
    expect(GAME_TOOLS.some(t => t.id === id)).toBe(false)
    const definition = ui.POKER_PRIVATE_UI_OPERATIONS.find(t => t.id === id)
    expect(definition).toBeDefined()
    const schema = z.fromJSONSchema(definition!.inputSchema as Parameters<typeof z.fromJSONSchema>[0])
    const value = op === "play" ? play : { ...play, instanceId: undefined, selections: undefined, choiceId: "choice", candidateIndex: 0 }
    const clean = Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined))
    expect(schema.safeParse(clean).success).toBe(true)
    expect(schema.safeParse({ ...clean, effectCode: "steal_all" }).success).toBe(false)
    expect(schema.safeParse({ ...clean, actionId: "not-uuid" }).success).toBe(false)
    expect(ui.GAME_UI_ROUTES[id].path({ roomCode: "1234" })).toBe(`/game/poker/rooms/1234/card/${op}`)
    expect(GAME_RESPONSE_SCHEMAS[id].safeParse({ ok: true, handId: "h", actionSeq: 4, cursor: "1:4", status: "completed" }).success).toBe(true)
  })
  it("卡牌状态不能把损坏金额当成合法新响应", () => {
    const schema = GAME_RESPONSE_SCHEMAS["app.game.poker.card.play"]
    expect(schema).toBeDefined()
    expect(schema!.safeParse({ ok: true, handId: "h", actionSeq: -1, cursor: "1:4", status: "completed" }).success).toBe(false)
  })
  it("旧行动仍可省略付款版本，新客户端能绑定一次性减免报价", () => {
    const tool = GAME_TOOLS.find(t => t.id === "app.game.poker.roll.start")!
    const schema = z.fromJSONSchema(tool.inputSchema as Parameters<typeof z.fromJSONSchema>[0])
    const value = { roomCode: "1234", handId: "h", street: "flop", expectedActionSeq: 3, controlVersion: 1, actionId: play.actionId, kind: "normal", cardIndex: 0, expectedFee: 20 }
    expect(schema.safeParse(value).success).toBe(true)
    expect(schema.safeParse({ ...value, expectedPaymentVersion: "quote-1" }).success).toBe(true)
  })
})
