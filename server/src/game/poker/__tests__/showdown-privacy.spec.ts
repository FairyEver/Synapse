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
;(url ? describe : describe.skip)("暂离座位的摊牌隐私", () => {
  const db = new PrismaClient({
    datasources: { db: { url: url ?? "postgresql://localhost/unused_e2e" } },
  }) as PrismaService
  const poker = new PokerService(db, new HallService(db)),
    actions = new PokerActionService(poker),
    read = new PokerReadService(poker)
  afterAll(() => db.$disconnect())
  it("未参与本手的旧座位不能读取摊牌，真实参与者即使下手暂离仍能读取", async () => {
    const a = randomUUID(),
      b = randomUUID(),
      c = randomUUID(),
      code = (await poker.createRoom(a, { maxSeats: 3, buyIn: 1000 })).roomCode
    for (const user of [a, b, c]) await joinForStartedHand(poker, user, code, {})
    await poker.sit(a, code, true)
    let state = await actions.state(a, code)
    expect(state.hole).toHaveLength(2)
    await actions.act(a, code, {
      handId: state.handId!,
      street: state.street!,
      actionId: randomUUID(),
      action: "fold",
    })
    await advanceNextHand(actions, code)
    expect((await actions.state(a, code)).handNo).toBe(2)
    await poker.sit(b, code, true)
    await poker.sit(c, code, true)
    for (let moves = 0; moves < 10; moves++) {
      state = await actions.state(b, code)
      if (state.street === "settled") break
      const userId = state.actionOnSeat === 1 ? b : c,
        turn = await actions.state(userId, code)
      await actions.act(userId, code, {
        handId: turn.handId!,
        street: turn.street!,
        actionId: randomUUID(),
        action: turn.toCall ? "call" : "check",
      })
    }
    const absentOwner = await actions.state(a, code),
      participant = await actions.state(b, code)
    expect(absentOwner).toMatchObject({ handNo: 2, street: "settled", status: "paused", hole: [] })
    for (const seat of absentOwner.seats) expect(seat).not.toHaveProperty("hole")
    expect(participant.hole).toHaveLength(2)
    expect(participant.seats.find((s) => s.seatNo === 1)?.hole).toHaveLength(2)
    expect(participant.seats.find((s) => s.seatNo === 2)?.hole).toHaveLength(2)
    expect(participant.seats.find((s) => s.seatNo === 0)).not.toHaveProperty("hole")
    for (const userId of [a, b]) {
      const publicView = await actions.state(userId, code, "public")
      expect(publicView).not.toHaveProperty("hole")
      for (const seat of publicView.seats) {
        if (userId === b && [1, 2].includes(seat.seatNo)) expect(seat.hole).toHaveLength(2)
        else expect(seat).not.toHaveProperty("hole")
      }
    }
    await expect(read.detail(a, code, 2)).rejects.toMatchObject({
      response: { code: "POKER_SEAT_NOT_FOUND" },
    })
    for (const seat of (await read.detail(b, code, 2)).seats) expect(seat.hole).toHaveLength(2)
  })
})
