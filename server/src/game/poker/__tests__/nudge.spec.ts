import { afterAll, describe, expect, it, vi } from "vitest"
import { PrismaClient } from "@prisma/client"
import { randomUUID } from "node:crypto"
import type { PrismaService } from "../../../prisma/prisma.service"
import type { NotificationService } from "../../../notifications/notification.service"
import { HallService } from "../../hall/hall.service"
import { PokerService } from "../poker.service"
import { PokerNudgeService } from "../poker-nudge.service"
import { gameTestDatabaseUrl } from "./test-database"
import { prepareAndStartInitialHand } from "./advance-next-hand"
const url = gameTestDatabaseUrl()
;(url ? describe : describe.skip)("提醒限流", () => {
  const db = new PrismaClient({
    datasources: { db: { url: url ?? "postgresql://localhost/unused_e2e" } },
  }) as PrismaService
  afterAll(() => { vi.unstubAllEnvs(); return db.$disconnect() })
  it("仅同桌可提醒等待60秒以上的行动位，5分钟内重复提醒被拒", async () => {
    vi.stubEnv("APP_PUBLIC_URL", "http://localhost:19700")
    const p = new PokerService(db, new HallService(db)),
      a = randomUUID(),
      b = randomUUID(),
      code = (await p.createRoom(a, { maxSeats: 2, buyIn: 1000 })).roomCode
    await p.join(a, code, {}, new Date(0))
    await p.join(b, code, {}, new Date(0))
    await prepareAndStartInitialHand(p, code, new Date(0))
    const create = vi.fn().mockResolvedValue({ id: "notification" }),
      deliver = vi.fn().mockResolvedValue(undefined)
    const n = new PokerNudgeService(p, {
      createInTransaction: create,
      deliverCommitted: deliver,
    } as unknown as NotificationService)
    await expect(n.nudge("outsider", code, 0, new Date(61000))).rejects.toThrow()
    await n.nudge(b, code, 0, new Date(61000))
    expect(create.mock.calls[0][1]).toMatchObject({
      userId: a,
      title: expect.stringContaining(code),
    })
    expect(deliver).toHaveBeenCalledWith(a, "notification")
    await expect(n.nudge(b, code, 0, new Date(61001))).rejects.toMatchObject({
      response: { code: "POKER_NUDGE_RATE_LIMITED" },
    })
  })
})
