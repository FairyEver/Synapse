import { describe, expect, it } from "vitest"
import { GAME_RESPONSE_SCHEMAS } from "./game-response-schemas"
import { tableResponse } from "../test/game-response-fixtures"
describe("Roll玩家统计契约", () => {
  it("严格限定公开统计字段，不接受私牌或非法金额，旧响应兼容", () => {
    const schema = GAME_RESPONSE_SCHEMAS["app.game.poker.table.state"]
    const stats = { hand: { players: 1, count: 2, paid: 12 }, room: { players: 3, count: 8, paid: 42 }, seats: [{ seatNo: 0, key: "p", hand: { count: 2, paid: 12 }, room: { count: 3, paid: 20 } }] }
    expect(schema.safeParse({ ...tableResponse, rollStats: stats }).success).toBe(true)
    expect(schema.safeParse(tableResponse).success).toBe(true)
    expect(schema.safeParse({ ...tableResponse, rollStats: { ...stats, candidates: ["As"] } }).success).toBe(false)
    expect(schema.safeParse({ ...tableResponse, rollStats: { ...stats, room: { ...stats.room, paid: -1 } } }).success).toBe(false)
  })
})
