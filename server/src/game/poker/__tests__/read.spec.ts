import { joinForStartedHand } from "./advance-next-hand"
import { afterAll, describe, expect, it } from "vitest"
import { PrismaClient } from "@prisma/client"
import { randomUUID } from "node:crypto"
import type { PrismaService } from "../../../prisma/prisma.service"
import { HallService } from "../../hall/hall.service"
import { PokerService } from "../poker.service"
import { PokerActionService } from "../poker-action.service"
import { PokerReadService } from "../poker-read.service"
import { gameTestDatabaseUrl } from "./test-database"
import { advanceNextHand } from "./advance-next-hand"
const url = gameTestDatabaseUrl()
;(url ? describe : describe.skip)("记录、暂离与不可变性", () => {
  const db = new PrismaClient({
    datasources: { db: { url: url ?? "postgresql://localhost/unused_e2e" } },
  }) as PrismaService
  const hall = new HallService(db),
    poker = new PokerService(db, hall),
    act = new PokerActionService(poker),
    read = new PokerReadService(poker)
  afterAll(() => db.$disconnect())
  it("暂离保留座位与筹码，当前手结束后暂停；回座恢复并可重启服务重连", async () => {
    const a = randomUUID(),
      b = randomUUID(),
      code = (await poker.createRoom(a, { maxSeats: 2, buyIn: 1000 })).roomCode
    await joinForStartedHand(poker, a, code, {})
    await joinForStartedHand(poker, b, code, {})
    const s = await act.state(a, code)
    await poker.sit(a, code, true)
    await act.act(a, code, {
      handId: s.handId!,
      street: s.street!,
      actionId: randomUUID(),
      action: "fold",
    })
    const paused = await act.state(a, code)
    expect(paused.status).toBe("paused")
    expect(paused.seats.find((s) => s.isMe)?.status).toBe("sitting_out")
    await poker.sit(a, code, false)
    const fresh = new PokerActionService(new PokerService(db, new HallService(db)))
    expect((await fresh.state(a, code)).handNo).toBe(1)
    await advanceNextHand(fresh, code)
    expect((await fresh.state(a, code)).handNo).toBe(2)
    expect((await hall.overview(a)).sessions).toHaveLength(1)
  })
  it("自己的版本与note可追溯；对手没有版本字段和弃牌底牌，外人不能读记录", async () => {
    const a = randomUUID(),
      b = randomUUID(),
      agent = await poker.upsertAgent(a, { persona: "私密策略" }),
      code = (await poker.createRoom(a, { maxSeats: 2, buyIn: 1000 })).roomCode
    await joinForStartedHand(poker, a, code, { agentId: agent.id })
    await joinForStartedHand(poker, b, code, {})
    const s = await act.state(a, code),
      id = randomUUID()
    await act.act(a, code, {
      handId: s.handId!,
      street: s.street!,
      actionId: id,
      action: "fold",
      note: "私密理由",
    })
    const mine = await read.detail(a, code, 1),
      other = await read.detail(b, code, 1)
    expect(mine.actions[0]).toMatchObject({
      note: "私密理由",
      personaVersion: { versionNo: 1, persona: "私密策略" },
    })
    expect(other.actions[0]).not.toHaveProperty("personaVersion")
    expect(other.actions[0]).not.toHaveProperty("note")
    expect(other.seats.find((s) => s.seatNo === 0)).not.toHaveProperty("hole")
    await expect(read.detail("stranger", code, 1)).rejects.toThrow()
    await expect(
      db.gamePokerAction.update({ where: { actionId: id }, data: { note: "overwrite" } }),
    ).rejects.toThrow()
    await expect(
      db.gamePokerAgentVersion.delete({ where: { id: agent.currentVersionId! } }),
    ).rejects.toThrow()
  })
  it("单手记录超过一万条时仍返回完整时间线", async () => {
    const a = randomUUID(),
      b = randomUUID(),
      code = (await poker.createRoom(a, { maxSeats: 2, buyIn: 1000 })).roomCode
    await joinForStartedHand(poker, a, code, {})
    await joinForStartedHand(poker, b, code, {})
    const state = await act.state(a, code),
      room = await db.gamePokerRoom.findUniqueOrThrow({ where: { code } })
    await db.gamePokerAction.createMany({
      data: Array.from({ length: 10001 }, (_, i) => ({
        handId: state.handId!,
        roomId: room.id,
        userId: a,
        seq: i + 1,
        seatNo: 0,
        street: "preflop",
        action: "check",
        potAfter: 3,
        actionId: randomUUID(),
      })),
    })
    const detail = await read.detail(a, code, 1)
    expect(detail.actions).toHaveLength(10001)
    expect(detail.actions.at(-1)?.seq).toBe(10001)
    await db.gamePokerRoom.update({
      where: { id: room.id },
      data: { status: "closed", actionDeadlineAt: null },
    })
  }, 30000)
  it("本人选手列表超过1000个也不静默截断", async () => {
    const userId = randomUUID()
    await db.gamePokerAgent.createMany({
      data: Array.from({ length: 1001 }, () => ({ userId, model: "", persona: "" })),
    })
    expect(await read.agents(userId)).toHaveLength(1001)
  })
  it("累计战绩不能在一万手处截断", async () => {
    const userId = randomUUID(),
      roomId = randomUUID()
    await db.gamePokerHandSummary.createMany({
      data: Array.from({ length: 10001 }, (_, i) => ({
        userId,
        roomId,
        handId: randomUUID(),
        handNo: i + 1,
        seatNo: 0,
        delta: 1,
        result: "won",
        holeCards: [],
        board: [],
      })),
    })
    expect(await read.stats(userId)).toMatchObject({ hands: 10001, netProfit: 10001, winRate: 1 })
  }, 30000)
  it("同桌对比只提供公开统计，不允许外人按房间查询私密选手信息", async () => {
    const a = randomUUID(),
      b = randomUUID(),
      code = (await poker.createRoom(a, { maxSeats: 2, buyIn: 1000 })).roomCode
    await joinForStartedHand(poker, a, code, {})
    await joinForStartedHand(poker, b, code, {})
    const comparison = await read.stats(a, code)
    expect(comparison.comparison).toHaveLength(2)
    expect(comparison.comparison?.filter((p) => p.isMe)).toHaveLength(1)
    expect(
      comparison.comparison?.every(
        (p) =>
          !Object.hasOwn(p, "userId") && !Object.hasOwn(p, "persona") && !Object.hasOwn(p, "note"),
      ),
    ).toBe(true)
    await expect(read.stats("stranger", code)).rejects.toThrow()
  })
  it("无进行中手牌时，30分钟无人在线解散并退还筹码", async () => {
    const a = randomUUID(),
      code = (await poker.createRoom(a, { maxSeats: 2, buyIn: 1000 })).roomCode
    await joinForStartedHand(poker, a, code, {}, new Date(0))
    await poker.sit(a, code, true, new Date(0))
    await poker.maintain(code, new Date(1800000))
    expect((await hall.overview(a)).points.available).toBe(1000000)
    expect((await act.state(a, code)).status).toBe("closed")
  })
})
