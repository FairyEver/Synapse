import { afterAll, describe, expect, it } from "vitest"
import { PrismaClient } from "@prisma/client"
import { randomUUID } from "node:crypto"
import type { PrismaService } from "../../../prisma/prisma.service"
import { HallService } from "../../hall/hall.service"
import { PokerService } from "../poker.service"
import { gameTestDatabaseUrl } from "./test-database"
const url = gameTestDatabaseUrl()
;(url ? describe : describe.skip)("创建结果丢失后的恢复", () => {
  const db = new PrismaClient({
    datasources: { db: { url: url ?? "postgresql://localhost/unused_e2e" } },
  }) as PrismaService
  const poker = new PokerService(db, new HallService(db))
  afterAll(() => db.$disconnect())
  it("同账号同creationId重试和并发创建只得到同一房间，解散后仍可恢复原结果", async () => {
    const userId = randomUUID(),
      input = { creationId: randomUUID(), maxSeats: 6, buyIn: 1000, name: "重复响应" }
    const copies = await Promise.all(
      Array.from({ length: 4 }, () => poker.createRoom(userId, input)),
    )
    const first = copies[0]
    expect(copies.every((room) => room.roomCode === first.roomCode)).toBe(true)
    expect(
      await poker.createRoom(userId, {
        ...input,
        creationId: input.creationId.toUpperCase(),
        maxSeats: 2,
      }),
    ).toEqual(first)
    expect(
      (await db.gamePokerRoom.findUniqueOrThrow({ where: { code: first.roomCode } })).maxSeats,
    ).toBe(6)
    await poker.close(userId, first.roomCode)
    expect(await poker.createRoom(userId, input)).toEqual(first)
    expect(await db.gamePokerRoom.count({ where: { ownerUserId: userId } })).toBe(1)
  })
  it("房间creationId按账号隔离，明确的新创建与旧客户端不互相合并", async () => {
    const a = randomUUID(),
      b = randomUUID(),
      creationId = randomUUID()
    const input = { creationId, maxSeats: 2, buyIn: 1000 }
    const one = await poker.createRoom(a, input),
      two = await poker.createRoom(b, input),
      another = await poker.createRoom(a, { ...input, creationId: randomUUID() })
    const legacy1 = await poker.createRoom(a, { maxSeats: 2, buyIn: 1000 }),
      legacy2 = await poker.createRoom(a, { maxSeats: 2, buyIn: 1000 })
    expect(new Set([one, two, another, legacy1, legacy2].map((room) => room.roomCode)).size).toBe(5)
  })
  it("新选手并发重试只创建一次同一提示词版本，重试前的新编辑仍可保存", async () => {
    const userId = randomUUID(),
      input = { creationId: randomUUID(), model: "模型", persona: "风格一" }
    const results = await Promise.all(
      Array.from({ length: 4 }, () => poker.upsertAgent(userId, input)),
    )
    expect(new Set(results.map((agent) => agent.id)).size).toBe(1)
    expect(await db.gamePokerAgent.count({ where: { userId } })).toBe(1)
    expect(await db.gamePokerAgentVersion.count({ where: { agentId: results[0].id } })).toBe(1)
    const edited = await poker.upsertAgent(userId, { ...input, persona: "风格二" })
    expect(edited).toMatchObject({ id: results[0].id, persona: "风格二", versionSeq: 2 })
  })
  it("选手creationId隔离账号和新草稿，不可冒充他人既有id", async () => {
    const a = randomUUID(),
      b = randomUUID(),
      input = { creationId: randomUUID(), persona: "私密" }
    const one = await poker.upsertAgent(a, input),
      two = await poker.upsertAgent(b, input),
      another = await poker.upsertAgent(a, { ...input, creationId: randomUUID() })
    expect(new Set([one.id, two.id, another.id]).size).toBe(3)
    await expect(poker.upsertAgent(b, { id: one.id, persona: "伪造" })).rejects.toMatchObject({
      response: { code: "POKER_SEAT_NOT_FOUND" },
    })
    await expect(poker.upsertAgent(a, { id: one.id, ...input })).rejects.toMatchObject({
      response: { code: "POKER_ILLEGAL_ACTION" },
    })
  })
  it("拒绝非法创建标识，不写入数据", async () => {
    const userId = randomUUID()
    await expect(
      poker.createRoom(userId, { creationId: "bad", maxSeats: 2, buyIn: 1000 }),
    ).rejects.toMatchObject({ response: { code: "POKER_ILLEGAL_ACTION" } })
    await expect(
      poker.upsertAgent(userId, { creationId: "bad", persona: "风格" }),
    ).rejects.toMatchObject({ response: { code: "POKER_ILLEGAL_ACTION" } })
    await expect(poker.upsertAgent(userId, { id: "", persona: "不应新建" })).rejects.toMatchObject({
      response: { code: "POKER_ILLEGAL_ACTION" },
    })
    expect(await db.gamePokerRoom.count({ where: { ownerUserId: userId } })).toBe(0)
    expect(await db.gamePokerAgent.count({ where: { userId } })).toBe(0)
  })
})
