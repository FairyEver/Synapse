import { joinForStartedHand } from "./advance-next-hand"
import { afterAll, describe, expect, it } from "vitest"
import { PrismaClient } from "@prisma/client"
import { randomUUID } from "node:crypto"
import type { PrismaService } from "../../../prisma/prisma.service"
import { HallService } from "../../hall/hall.service"
import { PokerService } from "../poker.service"
import { PokerActionService } from "../poker-action.service"
import { PokerReadService } from "../poker-read.service"
import { PokerArchiveService } from "../poker-archive.service"
import { gameTestDatabaseUrl } from "./test-database"
const url = gameTestDatabaseUrl()
;(url ? describe : describe.skip)("90天受控归档", () => {
  const db = new PrismaClient({
    datasources: { db: { url: url ?? "postgresql://localhost/unused_e2e" } },
  }) as PrismaService
  const hall = new HallService(db),
    poker = new PokerService(db, hall),
    actions = new PokerActionService(poker),
    read = new PokerReadService(poker),
    archive = new PokerArchiveService(db)
  afterAll(() => db.$disconnect())
  it("完整副本验证后清理热表，版本/幂等凭据永久保留，历史和隐私投影保持一致", async () => {
    const a = randomUUID(),
      b = randomUUID(),
      agent = await poker.upsertAgent(a, { persona: "归档私密风格" }),
      code = (await poker.createRoom(a, { maxSeats: 2, buyIn: 1000 })).roomCode
    const old = new Date(Date.now() - 91 * 86400000)
    await joinForStartedHand(poker, a, code, { agentId: agent.id }, old)
    await joinForStartedHand(poker, b, code, {}, old)
    const state = await actions.state(a, code),
      request = {
        handId: state.handId!,
        street: state.street!,
        actionId: randomUUID(),
        action: "fold" as const,
        note: "归档私密判断",
      }
    await poker.close(a, code)
    const response = await actions.act(a, code, request, new Date(old.getTime() + 1))
    const before = await read.detail(a, code, 1),
      beforeOther = await read.detail(b, code, 1),
      stats = await read.stats(a)
    await expect(
      db.gamePokerAction.delete({ where: { actionId: request.actionId } }),
    ).rejects.toThrow()
    expect(await archive.archiveHand(request.handId, new Date())).toBe(true)
    expect(await db.gamePokerAction.count({ where: { handId: request.handId } })).toBe(0)
    expect(await db.gamePokerHand.count({ where: { id: request.handId } })).toBe(0)
    expect(await db.gamePokerAgentVersion.count({ where: { agentId: agent.id } })).toBe(1)
    expect(await read.detail(a, code, 1)).toEqual(before)
    expect(await read.detail(b, code, 1)).toEqual(beforeOther)
    await expect(read.detail("stranger", code, 1)).rejects.toThrow()
    expect(await actions.act(a, code, request)).toEqual(response)
    expect(await archive.archiveHand(request.handId, new Date())).toBe(false)
    expect((await read.history(a)).items.some((h) => h.handId === request.handId)).toBe(true)
    expect(await read.stats(a)).toEqual(stats)
    expect((await poker.agentVersions(a, agent.id))[0].handCount).toBe(1)
    await expect(
      db.gamePokerHandArchive.delete({ where: { id: request.handId } }),
    ).rejects.toThrow()
  })
  it("90天内的已结束手牌不会被提前归档", async () => {
    const a = randomUUID(),
      b = randomUUID(),
      code = (await poker.createRoom(a, { maxSeats: 2, buyIn: 1000 })).roomCode
    await joinForStartedHand(poker, a, code, {})
    await joinForStartedHand(poker, b, code, {})
    const state = await actions.state(a, code)
    await actions.act(a, code, {
      handId: state.handId!,
      street: state.street!,
      actionId: randomUUID(),
      action: "fold",
    })
    expect(await archive.archiveHand(state.handId!, new Date(Date.now() + 365 * 86400000))).toBe(
      false,
    )
  })
})
