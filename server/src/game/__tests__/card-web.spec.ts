import "reflect-metadata"
import { Test } from "@nestjs/testing"
import request from "supertest"
import cookieParser from "cookie-parser"
import { afterEach, describe, expect, it, vi } from "vitest"
import { randomUUID } from "node:crypto"
import { GameController } from "../game.controller"
import { GameApiService } from "../game-api.service"
import { GameWebGuard } from "../game-web.guard"
import { PokerCardWebGuard } from "../poker-card-web.guard"
import { UserAuthGuard } from "../../auth/user-auth.guard"
import { UserAuthService } from "../../auth/user-auth.service"
import { PokerService } from "../poker/poker.service"
import { PokerCardService } from "../poker/poker-card.service"
import { PokerActionService } from "../poker/poker-action.service"
import { PokerReadService } from "../poker/poker-read.service"
import { PokerWaitService } from "../poker/poker-wait.service"
import { PokerEventsService } from "../poker/poker-events.service"
import { rollStore } from "../poker/__tests__/roll-service-store"
import { quoteCardPlay } from "../poker/engine/cards/commands"
import { createCardRegistry } from "../poker/engine/cards/catalog-v1"
import { createCardRegistryV2 } from "../poker/engine/cards/catalog-v2"
import type { HandState } from "../poker/engine/hand-runner"

const headers = { "x-synapse-game-user-id": "u", origin: "https://synapse.test", "x-synapse-poker-rules": "cards-v1,cards-v2,chips-v2" }
const cookie = "synapse_user_session=test-session"
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs() })
async function fixture(cardMode: boolean | "cards-v2" = true) {
  vi.stubEnv("APP_PUBLIC_URL", "https://synapse.test")
  const f = await rollStore("points", 2, cardMode === "cards-v2" ? { ruleOptions: { cards: true }, rollPricingVersion: null, cardRulesVersion: "cards-v2", chipRulesVersion: "chips-v2" } : cardMode ? { ruleOptions: { cards: true, roll: true }, rollPricingVersion: "roll-v1", cardRulesVersion: "cards-v1", chipRulesVersion: "chips-v2" } : undefined)
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(f.now)
  const actions = new PokerActionService(f.poker), read = new PokerReadService(f.poker), events = new PokerEventsService(f.poker), cards = new PokerCardService(f.poker), wait = new PokerWaitService(actions)
  const api = new GameApiService(f.hall, f.poker, actions, wait, read, {} as never)
  const module = await Test.createTestingModule({ controllers: [GameController], providers: [GameWebGuard, PokerCardWebGuard, UserAuthGuard,
    { provide: UserAuthService, useValue: { verifyWebSession: async (token: string) => token === "test-session" ? { userId: "u" } : null, verifyAccessToken: async () => ({ userId: "u" }) } },
    { provide: GameApiService, useValue: api }, { provide: PokerService, useValue: f.poker }, { provide: PokerActionService, useValue: actions }, { provide: PokerEventsService, useValue: events }, { provide: PokerCardService, useValue: cards },
  ] }).compile()
  const app = module.createNestApplication(); app.use(cookieParser()); await app.init()
  const input = (definitionId = "59", selections: Record<string, string | number> = {}) => {
    const hand = f.hands[0], h = hand.engineState as HandState, own = h.cards!.hands["admission-0"]
    let card = own.find(c => c.definitionId === definitionId)
    if (!card) for (const zone of [h.cards!.pool, h.cards!.hands["admission-1"]]) { const index = zone.findIndex(c => c.definitionId === definitionId); if (index >= 0) { card = zone.splice(index, 1)[0]; own.push(card); break } }
    if (!card) throw new Error("missing card fixture")
    const bindings = { roomCode: f.room.code, handId: hand.id, street: h.street, expectedActionSeq: hand.actionSeq, controlVersion: 0, actionId: randomUUID(), instanceId: card.id, selections }
    return { ...bindings, expectedPaymentVersion: quoteCardPlay(h, bindings, cardMode === "cards-v2" ? createCardRegistryV2() : createCardRegistry()).version }
  }
  return { f, app, input, close: async () => { wait.onModuleDestroy(); await app.close() } }
}
describe("真人卡牌HTTP边界", () => {
  it("网页invoke建房保留经过认证的真人来源与规则版本，Bearer和旧版本拒绝", async () => {
    const x = await fixture(), create = vi.spyOn(x.f.poker, "createRoom").mockResolvedValue({ roomCode: "654321" })
    const params = { maxSeats: 2, buyIn: 1000, ruleOptions: { cards: true } }, body = { operation: "app.game.poker.room.create", params }
    try {
      await request(x.app.getHttpServer()).post("/api/game/invoke").set(headers).set("Cookie", cookie).send(body).expect(201)
      expect(create).toHaveBeenCalledWith("u", params, "human", true)
      create.mockClear()
      await request(x.app.getHttpServer()).post("/api/game/invoke").set(headers).set("Authorization", "Bearer test-bearer").send(body).expect(403)
      await request(x.app.getHttpServer()).post("/api/game/invoke").set({ ...headers, "x-synapse-poker-rules": "cards-v1,chips-v2" }).set("Cookie", cookie).send(body).expect(403)
      expect(create).not.toHaveBeenCalled()
    } finally { await x.close() }
  })
  it("真实Cookie通过且幂等；Bearer附带伪造版本/身份/Cookie仍不能取真人回执", async () => {
    const x = await fixture(), body = x.input(), path = `/api/game/poker/rooms/${x.f.room.code}/card/play`
    try {
      const a = await request(x.app.getHttpServer()).post(path).set(headers).set("Cookie", cookie).send(body).expect(201)
      expect(a.body.ok).toBe(true)
      await request(x.app.getHttpServer()).post(path).set(headers).set("Cookie", cookie).set("Authorization", "Bearer test-bearer").send(body).expect(403)
      const b = await request(x.app.getHttpServer()).post(path).set({ ...headers, "x-synapse-poker-rules": "cards-v1,chips-v2" }).set("Cookie", cookie).send(body).expect(201)
      expect(b.body).toEqual(a.body); expect(x.f.hands[0].actionSeq).toBe(1)
    } finally { await x.close() }
  })
  it("缺版本、跨站、身份变化和来源/效果伪造均拒绝", async () => {
    const x = await fixture(), body = x.input(), path = `/api/game/poker/rooms/${x.f.room.code}/card/play`
    try {
      const { "x-synapse-poker-rules": _version, ...old } = headers
      await request(x.app.getHttpServer()).post(path).set(old).set("Cookie", cookie).send(body).expect(403)
      await request(x.app.getHttpServer()).post(path).set({ ...headers, origin: "https://evil.test" }).set("Cookie", cookie).send(body).expect(403)
      await request(x.app.getHttpServer()).post(path).set({ ...headers, "x-synapse-game-user-id": "other" }).set("Cookie", cookie).send(body).expect(409)
      await request(x.app.getHttpServer()).post(path).set(headers).set("Cookie", cookie).send({ ...body, caller: "human", effectCode: "steal_all" }).expect(400)
      expect(x.f.hands[0].actionSeq).toBe(0)
    } finally { await x.close() }
  })
  it("选择路由绑定持久化候选和原付款版本，公开invoke没有私有卡牌工具", async () => {
    const x = await fixture(), body = x.input("06", { hole: 0 }), base = `/api/game/poker/rooms/${x.f.room.code}`
    try {
      await request(x.app.getHttpServer()).post(`${base}/card/play`).set(headers).set("Cookie", cookie).send(body).expect(201)
      const pending = x.f.hands[0].engineState.cards.pending
      const { instanceId: _instance, selections: _choices, ...common } = body
      await request(x.app.getHttpServer()).post(`${base}/card/choose`).set(headers).set("Cookie", cookie).send({ ...common, actionId: randomUUID(), expectedActionSeq: 1, choiceId: pending.id, candidateIndex: 0 }).expect(201)
      const rejected = await request(x.app.getHttpServer()).post("/api/game/invoke").set("Authorization", "Bearer test-bearer").send({ operation: "app.game.poker.card.play", params: body }).expect(201)
      expect(rejected.body.ok).toBe(false); expect(rejected.body.failure.message).toContain("未知游戏操作")
      expect(x.f.hands[0].engineState.cards.pending).toBeNull()
    } finally { await x.close() }
  })
  it("Bearer访问Web状态仍为公开投影，Cookie保留本人持牌", async () => {
    const x = await fixture(), path = `/api/game/poker/rooms/${x.f.room.code}/state?perspective=owner`
    try {
      const bearer = await request(x.app.getHttpServer()).get(path).set(headers).set("Authorization", "Bearer test-bearer").expect(200)
      expect(bearer.body.cards).not.toHaveProperty("ownHand"); expect(bearer.body.seats.every((s: { hole?: string[] }) => !s.hole)).toBe(true)
      const own = await request(x.app.getHttpServer()).get(path).set(headers).set("Cookie", cookie).expect(200)
      expect(own.body.cards.ownHand).toHaveLength(3)
      expect(own.headers["cache-control"]).toBe("private, no-store")
      await request(x.app.getHttpServer()).post("/api/game/poker/rooms").set(headers).set("Authorization", "Bearer test-bearer").send({ maxSeats: 2, buyIn: 1000, ruleOptions: { cards: true } }).expect(403)
    } finally { await x.close() }
  })
  it("新版五选一只扣费一次，候选仅本人可恢复，选第 5 张不再收费", async () => {
    const x = await fixture("cards-v2"), body = x.input("07"), base = `/api/game/poker/rooms/${x.f.room.code}`
    const http = request(x.app.getHttpServer()), before = x.f.hands[0].pot
    try {
      const old = { ...headers, "x-synapse-poker-rules": "cards-v1,chips-v2" }
      await http.post(`${base}/card/play`).set(old).set("Cookie", cookie).send(body).expect(403)
      const play = await http.post(`${base}/card/play`).set(headers).set("Cookie", cookie).send(body).expect(201)
      expect(play.body.status).toBe("choice_required")
      const pending = x.f.hands[0].engineState.cards.pending
      expect(pending.candidates).toHaveLength(5)
      const [action] = x.f.actions
      expect(action.amount).toBeGreaterThan(0)
      expect(action.potAfter).toBe(before + action.amount)
      await http.post(`${base}/card/play`).set(headers).set("Cookie", cookie).send(body).expect(201)
      expect(x.f.actions).toHaveLength(1)
      const state = await http.get(`${base}/state?perspective=owner`).set(headers).set("Cookie", cookie).expect(200)
      expect(state.body.cards.pending.candidates).toEqual(pending.candidates)
      const publicState = await http.get(`${base}/state?perspective=owner`).set(headers).set("Authorization", "Bearer test-bearer").expect(200)
      expect(publicState.body.cards.pending).toBeUndefined()
      const { instanceId: _instance, selections: _selections, ...common } = body
      await http.post(`${base}/card/choose`).set(headers).set("Cookie", cookie)
        .send({ ...common, actionId: randomUUID(), expectedActionSeq: 1, choiceId: pending.id, candidateIndex: 4 }).expect(201)
      expect(x.f.actions[1]).toMatchObject({ amount: 0, potAfter: action.potAfter })
      expect(x.f.hands[0].engineState.cards.pending).toBeNull()
    } finally { await x.close() }
  })
  it.each([undefined, "false"])("未设置环境开关或残留旧配置（%s）时，网页仍可建卡牌房", async legacySetting => {
    vi.stubEnv("GAME_POKER_CARD_MODE_ENABLED", legacySetting)
    const x = await fixture(), http = request(x.app.getHttpServer())
    try {
      const guide = await http.post("/api/game/invoke").set(headers).set("Cookie", cookie).send({ operation: "app.game.poker.guide", params: {} }).expect(201)
      for (const mode of ["points", "practice"]) {
        const created = await http.post("/api/game/poker/rooms").set(headers).set("Cookie", cookie)
          .send({ mode, maxSeats: 2, buyIn: 1000, ruleOptions: { cards: true } }).expect(201)
        const room = await x.f.poker.prisma.gamePokerRoom.findUnique({ where: { code: created.body.roomCode } })
        expect(room).toMatchObject({ mode, ruleOptions: { cards: true }, cardRulesVersion: "cards-v2", chipRulesVersion: "chips-v2" })
      }
      expect(guide.body).toMatchObject({ ok: true, data: { cards: { available: true, supportedVersions: ["cards-v1", "cards-v2", "chips-v2"], aiPlay: false } } })
    } finally { await x.close() }
  })
  it("普通旧房保留Bearer网页读取与控制交接，不要求卡牌版本", async () => {
    const x = await fixture(false), base = `/api/game/poker/rooms/${x.f.room.code}`
    try {
      const own = await request(x.app.getHttpServer()).get(`${base}/state?perspective=owner`).set("Authorization", "Bearer test-bearer").expect(200)
      expect(own.body.seats.find((s: { seatNo: number }) => s.seatNo === 0).hole).toHaveLength(2)
      await request(x.app.getHttpServer()).post(`${base}/control`).set("Authorization", "Bearer test-bearer").send({ controlVersion: 0, action: "takeover" }).expect(201)
      expect(x.f.seats[0].controller).toBe("human")
    } finally { await x.close() }
  })
})
