import { z } from "zod"
import { expect, it } from "vitest"
import { GAME_TOOLS } from "./game.js"

it("建房契约允许2至6人，拒绝第7人和非法座位数", () => {
  const tool = GAME_TOOLS.find(t => t.id === "app.game.poker.room.create")!
  const schema = z.fromJSONSchema(tool.inputSchema as Parameters<typeof z.fromJSONSchema>[0])
  for (const maxSeats of [2, 3, 4, 5, 6]) expect(schema.safeParse({ maxSeats, buyIn: 1000 }).success).toBe(true)
  for (const maxSeats of [1, 7, 10, 2.5]) expect(schema.safeParse({ maxSeats, buyIn: 1000 }).success).toBe(false)
})

it.each(["points", "practice"])("%s建房契约使用新的四档金额", mode => {
  const tool = GAME_TOOLS.find(t => t.id === "app.game.poker.room.create")!
  const schema = z.fromJSONSchema(tool.inputSchema as Parameters<typeof z.fromJSONSchema>[0])
  for (const buyIn of [1000, 5000, 10000, 50000]) expect(schema.safeParse({ mode, maxSeats: 6, buyIn }).success).toBe(true)
  for (const buyIn of [500, 2000, 0, 1001, 50001]) expect(schema.safeParse({ mode, maxSeats: 6, buyIn }).success).toBe(false)
})
