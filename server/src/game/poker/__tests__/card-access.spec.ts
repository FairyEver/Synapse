import { afterEach, describe, expect, it, vi } from "vitest"
import { PokerService } from "../poker.service"
import { PokerActionService } from "../poker-action.service"
import { PokerRollService } from "../poker-roll.service"
import { PokerWaitService } from "../poker-wait.service"
import { cardReadPolicy } from "../poker-mode-policy"
import { rollStore } from "./roll-service-store"
import { randomUUID } from "node:crypto"
import { GameApiService } from "../../game-api.service"

afterEach(() => vi.unstubAllEnvs())
const fixture = () => rollStore("points", 2, { ruleOptions: { cards: true, roll: true }, rollPricingVersion: "roll-v1", cardRulesVersion: "cards-v1", chipRulesVersion: "chips-v2" })
describe("卡牌模式服务策略", () => {
  it.each(["join", "ready", "start", "claim", "request_ai", "sit", "checkpoint"])("直接%s也拒绝AI参赛或交接", async operation => {
    const f = await fixture(), hand = f.hands[0]
    const call = () => operation === "join" ? f.poker.join("new-agent", f.room.code, {}, f.now, "mcp")
      : operation === "ready" ? f.poker.ready("u", f.room.code, hand.id, 0, f.now, "mcp")
      : operation === "start" ? f.poker.start("u", f.room.code, hand.id, 0, f.now, "mcp")
      : operation === "claim" ? f.poker.claim("u", f.room.code, 0, f.now)
      : operation === "request_ai" ? f.poker.control("u", f.room.code, "request_ai", 0, f.now)
      : operation === "sit" ? f.poker.sit("u", f.room.code, true, f.now, "mcp", 0)
      : f.poker.checkpoint("u", f.room.code, undefined, f.now)
    await expect(call()).rejects.toMatchObject({ response: { code: "POKER_CARD_AI_DISABLED" } })
    expect(f.seats[0]).toMatchObject({ controller: "human", handoffPending: false })
  })
  it("下注/Roll拒绝发生在回执读取之前，wait不返回任何私牌", async () => {
    const f = await fixture(), actionId = randomUUID(), hand = f.hands[0]
    f.receipts.push({ actionId, roomId: f.room.id, userId: "u", response: { private: "old-private" } })
    await expect(new PokerActionService(f.poker).act("u", f.room.code, { handId: hand.id, street: "preflop", actionId, action: "fold" }, f.now, "mcp")).rejects.toMatchObject({ response: { code: "POKER_CARD_AI_DISABLED" } })
    await expect(new PokerRollService(f.poker).choose("u", { roomCode: f.room.code, handId: hand.id, actionId, rollId: "old", candidateIndex: 0, expectedActionSeq: 0, controlVersion: 0 }, f.now, "mcp")).rejects.toMatchObject({ response: { code: "POKER_CARD_AI_DISABLED" } })
    f.seats[0].controller = "ai"
    const wait = new PokerWaitService(new PokerActionService(f.poker))
    try { const result = await wait.wait("u", f.room.code, "", 0, undefined, f.now); expect(result.status).toBe("control_released"); expect(result).not.toHaveProperty("hole"); expect(result).not.toHaveProperty("roll") }
    finally { wait.onModuleDestroy() }
  })
  it("公开invoke不接受私有卡牌操作，也不接受来源伪造", async () => {
    const api = new GameApiService({} as never, {} as never, {} as never, {} as never, {} as never, {} as never)
    for (const operation of ["app.game.poker.card.play", "app.game.poker.card.choose"]) await expect(api.run("u", operation, {})).rejects.toThrow("未知游戏操作")
    await expect(api.run("u", "app.game.poker.seat.join", { roomCode: "1234", caller: "human" })).rejects.toThrow()
  })
  it("创建门槛默认关闭；普通新房固定chips-v2，旧房不回填", async () => {
    const creates: Record<string, unknown>[] = []
    const prisma = { user: { findUnique: async () => null }, gamePokerRoom: { create: async ({ data }: { data: Record<string, unknown> }) => { creates.push(data); return { code: "5678" } } } }
    const service = new PokerService(prisma as never, {} as never)
    vi.stubEnv("GAME_POKER_CARD_MODE_ENABLED", "false")
    await expect(service.createRoom("u", { maxSeats: 2, buyIn: 1000, ruleOptions: { cards: true } }, "human", true)).rejects.toMatchObject({ response: { code: "POKER_CARD_MODE_UNAVAILABLE" } })
    vi.stubEnv("GAME_POKER_CARD_MODE_ENABLED", "true")
    await expect(service.createRoom("u", { maxSeats: 2, buyIn: 1000, ruleOptions: { cards: true } }, "mcp", true)).rejects.toMatchObject({ response: { code: "POKER_CARD_AI_DISABLED" } })
    await expect(service.createRoom("u", { maxSeats: 2, buyIn: 1000, ruleOptions: { cards: true } }, "human", false)).rejects.toMatchObject({ response: { code: "POKER_CARD_VERSION_UNSUPPORTED" } })
    await service.createRoom("u", { maxSeats: 2, buyIn: 1000 })
    expect(creates[0]).toMatchObject({ chipRulesVersion: "chips-v2" }); expect(creates[0]).not.toHaveProperty("cardRulesVersion")
    await service.createRoom("u", { maxSeats: 2, buyIn: 1000, ruleOptions: { cards: true } }, "human", true)
    expect(creates[1]).toMatchObject({ cardRulesVersion: "cards-v1", chipRulesVersion: "chips-v2" })
    const f = await rollStore(); expect(f.room.chipRulesVersion).toBeUndefined(); expect(f.hands[0].engineState.chipRulesVersion).toBeUndefined()
  })
  it("读取策略将卡牌房MCP降为公开，不影响普通房的本人策略", () => {
    const requested = { audience: "desktop" as const, perspective: "owner" as const, handId: "h", actionSeq: 0, nowMs: 0, self: { userId: "u", admissionId: "a", seatNo: 0, controlVersion: 0 } }
    expect(cardReadPolicy({ cardRulesVersion: "cards-v1" }, "mcp", requested)).toMatchObject({ audience: "decision", perspective: "public", self: undefined })
    expect(cardReadPolicy({}, "mcp", requested)).toEqual(requested)
  })
})
