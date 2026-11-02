import { joinForStartedHand, prepareAndStartInitialHand } from "./advance-next-hand"
import { afterAll, describe, expect, it, vi } from "vitest"
import { PrismaClient } from "@prisma/client"
import { randomUUID } from "node:crypto"
import { GAME_TOOLS } from "@synapse/shared/game-contracts"
import type { PrismaService } from "../../../prisma/prisma.service"
import { HallService } from "../../hall/hall.service"
import { PokerService } from "../poker.service"
import { PokerActionService } from "../poker-action.service"
import { PokerReadService } from "../poker-read.service"
import { PokerBotService } from "../poker-bot.service"
import { PokerArchiveService } from "../poker-archive.service"
import { PokerNudgeService } from "../poker-nudge.service"
import { gameTestDatabaseUrl } from "./test-database"
const url = gameTestDatabaseUrl()
describe("陪练MCP注册", () => {
  it("提供30项可检索能力，机器人管理不含行动或身份覆盖参数", () => {
    expect(GAME_TOOLS).toHaveLength(30)
    expect(GAME_TOOLS.find((t) => t.id === "app.game.poker.bot.add")?.inputSchema.required).toEqual(["roomCode", "creationId"])
    expect(GAME_TOOLS.find((t) => t.id === "app.game.poker.bot.remove")?.inputSchema.required).toEqual(["roomCode", "botId"])
  })
})
;(url ? describe : describe.skip)("陪练热冷记录隔离", () => {
  const db = new PrismaClient({ datasources: { db: { url: url ?? "postgresql://localhost/unused_e2e" } } }) as PrismaService
  const hall = new HallService(db), poker = new PokerService(db, hall), actions = new PokerActionService(poker), read = new PokerReadService(poker), bots = new PokerBotService(poker)
  afterAll(() => db.$disconnect())
  it("默认历史/统计/版本手数不计陪练，归档前后隔离一致", async () => {
    const u = randomUUID(), b = randomUUID(), now = new Date(Date.now() - 100 * 86400000)
    const agent = await poker.upsertAgent(u, { persona: "练习风格" })
    const code = (await poker.createRoom(u, { maxSeats: 2, buyIn: 1000, mode: "practice" })).roomCode
    await joinForStartedHand(poker, u, code, { agentId: agent.id }, now)
    await joinForStartedHand(poker, b, code, {}, now)
    await poker.close(u, code, now)
    const state = await actions.state(u, code)
    await actions.act(u, code, { handId: state.handId!, street: state.street!, actionId: randomUUID(), action: "fold" }, now)
    for (let attempt = 0; attempt < 2; attempt++) {
      expect((await read.history(u)).items).toHaveLength(0)
      expect((await read.history(u, 0, 50, "practice")).items).toHaveLength(1)
      expect((await read.stats(u)).hands).toBe(0)
      expect((await read.stats(u, undefined, "practice")).hands).toBe(1)
      expect((await poker.agentVersions(u, agent.id))[0].handCount).toBe(0)
      expect(await read.detail(u, code, 1)).toMatchObject({ mode: "practice", actions: [expect.objectContaining({ actionSource: "mcp" })] })
      if (!attempt) expect(await new PokerArchiveService(db).archiveHand(state.handId!, new Date())).toBe(true)
    }
    expect((await hall.overview(u)).points.netProfit).toBe(0)
  })
  it("陪练默认不进入房间列表，对机器人提醒被服务端拒绝且不发通知", async () => {
    const u = randomUUID(), code = (await poker.createRoom(u, { maxSeats: 2, buyIn: 1000, mode: "practice" })).roomCode
    const bot = await bots.add(u, code, randomUUID())
    await prepareAndStartInitialHand(poker, code)
    await joinForStartedHand(poker, u, code, {})
    expect((await read.lobby()).items.some((r) => r.roomCode === code)).toBe(false)
    expect((await read.lobby(0, 100, "practice")).items.some((r) => r.roomCode === code)).toBe(true)
    const notification = { createInTransaction: vi.fn(), deliverCommitted: vi.fn() }
    await expect(new PokerNudgeService(poker, notification as never).nudge(u, code, bot.seatNo, new Date(Date.now() + 61000))).rejects.toThrow()
    expect(notification.createInTransaction).not.toHaveBeenCalled()
  })
})
