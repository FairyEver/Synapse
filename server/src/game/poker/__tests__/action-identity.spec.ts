import { afterAll, describe, expect, it } from "vitest"
import { PrismaClient } from "@prisma/client"
import { randomUUID } from "node:crypto"
import type { PrismaService } from "../../../prisma/prisma.service"
import { HallService } from "../../hall/hall.service"
import { PokerService } from "../poker.service"
import { PokerActionService } from "../poker-action.service"
import { gameTestDatabaseUrl } from "./test-database"
import { advanceNextHand } from "./advance-next-hand"

const url = gameTestDatabaseUrl()
;(url ? describe : describe.skip)("当前手行动身份快照", () => {
  const db = new PrismaClient({
    datasources: { db: { url: url ?? "postgresql://localhost/unused_e2e" } },
  }) as PrismaService
  const poker = new PokerService(db, new HallService(db)),
    actions = new PokerActionService(poker)
  afterAll(() => db.$disconnect())

  it("旧玩家超时离场后同座位新玩家不能继承旧行动的名字", async () => {
    const [a, b, c, replacement] = Array.from({ length: 4 }, () => randomUUID())
    const code = (await poker.createRoom(a, { maxSeats: 3, buyIn: 1000 })).roomCode
    await poker.join(a, code, {}, new Date(0))
    await poker.join(b, code, { modelName: "旧模型" }, new Date(0))
    await poker.join(c, code, {}, new Date(0))
    const first = await actions.state(a, code)
    await actions.act(
      a,
      code,
      {
        handId: first.handId!,
        street: first.street!,
        actionId: randomUUID(),
        action: "fold",
      },
      new Date(1),
    )
    const nextAt = await advanceNextHand(actions, code)
    const second = await actions.state(b, code)
    expect(second).toMatchObject({ handNo: 2, actionOnSeat: 1 })
    await actions.expire(code, new Date(nextAt.getTime() + 600000))
    await poker.join(replacement, code, { modelName: "新模型" }, new Date(nextAt.getTime() + 600001))

    for (const perspective of ["owner", "public"] as const) {
      const view = await actions.state(replacement, code, perspective)
      expect(view.handNo).toBe(2)
      expect(view.seats.find((s) => s.seatNo === 1)?.displayName).toBe("选手的新模型")
      expect(view.recentActions).toHaveLength(1)
      expect(view.recentActions[0]).toMatchObject({
        seatNo: 1,
        displayName: "选手的旧模型",
        isAuto: true,
        action: "fold",
      })
      expect(view.recentActions[0]).not.toHaveProperty("userId")
      expect(view.recentActions[0]).not.toHaveProperty("personaVersionId")
      expect(view.recentActions[0]).not.toHaveProperty("note")
    }
  })
})
