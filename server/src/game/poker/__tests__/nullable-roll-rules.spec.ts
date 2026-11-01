import { describe, expect, it } from "vitest"
import { GAME_RESPONSE_SCHEMAS } from "@synapse/shared/game-ui"
import type { PrismaService } from "../../../prisma/prisma.service"
import { PokerActionService } from "../poker-action.service"
import { PokerReadService } from "../poker-read.service"
import { PokerService } from "../poker.service"
import { rollStore } from "./roll-service-store"

// Prisma returns SQL NULL, including migrated rooms and new default-off rooms.
// Only persistence is doubled; projections and response validation are production code.
describe.each([{}, { roll: false }])("nullable disabled Roll rules %j", ruleOptions => {
  const setup = () => rollStore("points", 3, { ruleOptions, rollPricingVersion: null })
  const wire = (value: unknown) => JSON.parse(JSON.stringify(value))

  it("keeps lobby pages compatible with the shared response schema", async () => {
    const f = await setup()
    const response = await f.transact(c => new PokerReadService(new PokerService(c.tx as unknown as PrismaService, f.hall)).lobby())
    expect(GAME_RESPONSE_SCHEMAS["app.game.poker.lobby.list"].safeParse(wire(response)).success).toBe(true)
    expect(response.items[0].rules).not.toHaveProperty("rollPricingVersion")
  })

  it("keeps authenticated table and room responses compatible", async () => {
    const f = await setup()
    const response = await f.transact(c => new PokerActionService(f.poker).view(c, "u", "owner", false))
    for (const operation of ["app.game.poker.table.state", "app.game.poker.room.get"]) {
      expect(GAME_RESPONSE_SCHEMAS[operation].safeParse(wire(response)).success).toBe(true)
    }
    expect(response.rules).not.toHaveProperty("rollPricingVersion")
    expect(response).not.toHaveProperty("rollPricingVersion")
  })

  it("keeps history rows compatible after projecting the nullable room", async () => {
    const f = await setup()
    const response = await f.transact(async c => {
      const prisma = {
        gamePokerRoom: c.tx.gamePokerRoom,
        $queryRaw: async () => [{ id: "summary", roomId: f.room.id, handId: "previous-hand", handNo: 1,
          seatNo: 0, delta: 0, result: "split", holeCards: ["As", "Kh"], board: [], createdAt: f.now }],
      }
      return new PokerReadService(new PokerService(prisma as unknown as PrismaService, f.hall)).history("u")
    })
    expect(GAME_RESPONSE_SCHEMAS["app.game.poker.hand.history"].safeParse(wire(response)).success).toBe(true)
    expect(response.items[0].rules).not.toHaveProperty("rollPricingVersion")
  })

  it("normalizes the rules stored by startNext and exposes the new hand through the shared schema", async () => {
    const f = await setup()
    expect(f.room.rollPricingVersion).toBeNull()
    expect(f.hands[0].rules).not.toHaveProperty("rollPricingVersion")
    expect(f.hands[0].engineState).not.toHaveProperty("rollPricingVersion")
    expect(f.hands[0].engineState.roll).toBeUndefined()
    const response = await f.transact(c => new PokerActionService(f.poker).view(c, "u", "owner", false))
    expect(response.handId).toBe(f.hands[0].id)
    expect(GAME_RESPONSE_SCHEMAS["app.game.poker.table.state"].safeParse(wire(response)).success).toBe(true)
  })
})
