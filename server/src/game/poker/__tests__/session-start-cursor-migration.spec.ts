import { joinForStartedHand } from "./advance-next-hand"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { afterAll, describe, expect, it } from "vitest"
import { PrismaClient } from "@prisma/client"
import { randomUUID } from "node:crypto"
import type { PrismaService } from "../../../prisma/prisma.service"
import { HallService } from "../../hall/hall.service"
import { PokerService } from "../poker.service"
import { PokerActionService } from "../poker-action.service"
import { gameTestDatabaseUrl } from "./test-database"

const url = gameTestDatabaseUrl()
;(url ? describe : describe.skip)("旧在座会话的入座起点回填", () => {
  const db = new PrismaClient({
    datasources: { db: { url: url ?? "postgresql://localhost/unused_e2e" } },
  }) as PrismaService
  const hall = new HallService(db),
    poker = new PokerService(db, hall),
    actions = new PokerActionService(poker)
  afterAll(() => db.$disconnect())

  it("实际迁移SQL取本座位下一手边界，保留未知边界与其他游戏数据且不改变点数", async () => {
    const [owner, a, b] = Array.from({ length: 3 }, () => randomUUID())
    const { roomCode: code } = await poker.createRoom(owner, { maxSeats: 3, buyIn: 1000 })
    await joinForStartedHand(poker, a, code, {})
    await joinForStartedHand(poker, b, code, {})
    await joinForStartedHand(poker, owner, code, {})
    const room = await db.gamePokerRoom.findUniqueOrThrow({ where: { code } })
    await db.gameSession.updateMany({ where: { gameRoomId: room.id }, data: { startCursor: null } })
    await db.gamePokerSeat.updateMany({
      where: { roomId: room.id, userId: b },
      data: { joinedHandNo: null },
    })
    const other = await db.gameSession.create({
      data: {
        userId: owner,
        gameKind: "other",
        gameRoomId: room.id,
        status: "active",
        lastActiveAt: new Date(),
        startCursor: "other:opaque",
      },
    })
    const before = (await hall.overview(owner)).points
    const migration = readFileSync(
      join(
        __dirname,
        "../../../../prisma/migrations/20261030120000_game_session_start_cursor/migration.sql",
      ),
      "utf8",
    )
    // Column creation is exercised by migrate deploy on the fresh test DB.
    // Run its exact backfill against legacy-shaped, already seated fixtures.
    await db.$executeRawUnsafe(migration.slice(migration.indexOf('UPDATE "GameSession"')))
    const session = await db.gameSession.findUniqueOrThrow({
      where: {
        userId_gameKind_gameRoomId: { userId: owner, gameKind: "poker", gameRoomId: room.id },
      },
    })
    expect(session.startCursor).toBe("2")
    expect((await db.gameSession.findUniqueOrThrow({ where: { id: other.id } })).startCursor).toBe(
      "other:opaque",
    )
    expect(
      (
        await db.gameSession.findUniqueOrThrow({
          where: {
            userId_gameKind_gameRoomId: { userId: b, gameKind: "poker", gameRoomId: room.id },
          },
        })
      ).startCursor,
    ).toBeNull()
    expect((await hall.overview(owner)).points).toEqual(before)
    expect(
      (await hall.overview(owner)).sessions.every((s) => !Object.hasOwn(s, "startCursor")),
    ).toBe(true)
    await poker.close(owner, code)
    const state = await actions.state(a, code)
    await actions.act(a, code, {
      handId: state.handId!,
      street: state.street!,
      actionId: randomUUID(),
      action: "fold",
    })
  })
})
