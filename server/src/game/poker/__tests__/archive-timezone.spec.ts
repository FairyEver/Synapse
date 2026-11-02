import { joinForStartedHand } from "./advance-next-hand"
import { afterAll, describe, expect, it } from "vitest"
import { PrismaClient } from "@prisma/client"
import { randomUUID } from "node:crypto"
import type { PrismaService } from "../../../prisma/prisma.service"
import { HallService } from "../../hall/hall.service"
import { PokerService } from "../poker.service"
import { PokerActionService } from "../poker-action.service"
import { PokerArchiveService } from "../poker-archive.service"
import { gameTestDatabaseUrl } from "./test-database"

const url = gameTestDatabaseUrl()
;(url ? describe : describe.skip)("归档90天边界使用UTC", () => {
  const isolatedUrl = new URL(url ?? "postgresql://localhost/unused_e2e")
  isolatedUrl.searchParams.set("connection_limit", "1")
  const db = new PrismaClient({
    datasources: { db: { url: isolatedUrl.toString() } },
  }) as PrismaService
  const poker = new PokerService(db, new HallService(db)),
    actions = new PokerActionService(poker),
    archive = new PokerArchiveService(db)
  afterAll(() => db.$disconnect())

  async function settled(ageMs: number) {
    const a = randomUUID(),
      b = randomUUID(),
      old = new Date(Date.now() - ageMs),
      code = (await poker.createRoom(a, { maxSeats: 2, buyIn: 1000 })).roomCode
    await joinForStartedHand(poker, a, code, {}, old)
    await joinForStartedHand(poker, b, code, {}, old)
    await poker.close(a, code)
    const state = await actions.state(a, code)
    await actions.act(
      a,
      code,
      {
        handId: state.handId!,
        street: state.street!,
        actionId: randomUUID(),
        action: "fold",
      },
      old,
    )
    return state.handId!
  }
  it("UTC+8创建的空桌超过30分钟即可维护关闭", async () => {
    await db.$executeRawUnsafe("SET TIME ZONE 'Asia/Shanghai'")
    const now = new Date(),
      code = (await poker.createRoom(randomUUID(), { maxSeats: 2, buyIn: 1000 })).roomCode
    await poker.maintain(code, new Date(now.getTime() + 31 * 60000))
    expect((await actions.state(randomUUID(), code)).status).toBe("closed")
  })
  it("UTC+8不能将89天20小时的手牌提前归档", async () => {
    await db.$executeRawUnsafe("SET TIME ZONE 'Asia/Shanghai'")
    const handId = await settled((89 * 24 + 20) * 3600000)
    expect(await archive.archiveHand(handId, new Date())).toBe(false)
    expect(await db.gamePokerHand.count({ where: { id: handId } })).toBe(1)
    expect(await db.gamePokerHandArchive.count({ where: { id: handId } })).toBe(0)
  })
  it("UTC-8满90天后可归档，不额外延迟八小时", async () => {
    await db.$executeRawUnsafe("SET TIME ZONE 'Etc/GMT+8'")
    const handId = await settled(90 * 86400000 + 1000)
    expect(await archive.archiveHand(handId, new Date())).toBe(true)
    expect(await db.gamePokerHand.count({ where: { id: handId } })).toBe(0)
    expect(await db.gamePokerHandArchive.count({ where: { id: handId } })).toBe(1)
  })
  it("UTC-8后台扫描同样能找到刚满90天的手牌", async () => {
    await db.$executeRawUnsafe("SET TIME ZONE 'Etc/GMT+8'")
    const handId = await settled(90 * 86400000 + 1000)
    let previous = Infinity
    for (;;) {
      const remaining = await db.gamePokerHand.count({ where: { status: "settled" } })
      if (remaining >= previous) break
      previous = remaining
      await archive.scan()
    }
    expect(await db.gamePokerHand.count({ where: { id: handId } })).toBe(0)
    expect(await db.gamePokerHandArchive.count({ where: { id: handId } })).toBe(1)
  })
  it.each(["action", "hand"])(
    "即使存在完整副本和归档标记，%s guard仍拒绝清理不足90天的热记录",
    async (kind) => {
      await db.$executeRawUnsafe("SET TIME ZONE 'Asia/Shanghai'")
      const handId = await settled((89 * 24 + 20) * 3600000)
      await db.$executeRaw`
      INSERT INTO "GamePokerHandArchive"("id","roomId","handNo","participantIds","data","endedAt")
      SELECT h."id",h."roomId",h."handNo",ARRAY(SELECT "userId" FROM "GamePokerHandSeat" WHERE "handId"=h."id"),
        jsonb_build_object('hand',to_jsonb(h)-'engineState',
          'actions',(SELECT jsonb_agg(to_jsonb(a)) FROM "GamePokerAction" a WHERE a."handId"=h."id"),
          'seats',(SELECT jsonb_agg(to_jsonb(s)) FROM "GamePokerHandSeat" s WHERE s."handId"=h."id"),
          'summaries',(SELECT jsonb_agg(to_jsonb(s)) FROM "GamePokerHandSummary" s WHERE s."handId"=h."id")),h."endedAt"
      FROM "GamePokerHand" h WHERE h."id"=${handId}`
      await expect(
        db.$transaction(async (tx) => {
          await tx.$queryRaw`SELECT set_config('synapse.game.archive_hand',${handId},true)`
          if (kind === "action")
            await tx.$executeRaw`DELETE FROM "GamePokerAction" WHERE "handId"=${handId}`
          else await tx.$executeRaw`DELETE FROM "GamePokerHand" WHERE "id"=${handId}`
        }),
      ).rejects.toThrow()
      expect(await db.gamePokerAction.count({ where: { handId } })).toBe(1)
      expect(await db.gamePokerHand.count({ where: { id: handId } })).toBe(1)
    },
  )
})
