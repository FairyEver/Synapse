import { describe, expect, it } from "vitest"
import { GAME_RESPONSE_SCHEMAS } from "./game-response-schemas"
import { tableResponse } from "../test/game-response-fixtures"

for (const operation of ["app.game.poker.table.state", "app.game.poker.room.get"]) describe(`${operation}本手日志`, () => {
  const schema = GAME_RESPONSE_SCHEMAS[operation]
  const entry = { seq: 1, seatNo: 0, displayName: "原玩家", street: "preflop", action: "roll", amount: 20, isAuto: false, roll: { kind: "super", count: 1, status: "pending" } }
  const parse = (log: unknown) => schema.safeParse({ ...tableResponse, handLog: log })
  it("兼容旧响应与完整/截断公开日志", () => {
    expect(schema.safeParse(tableResponse).success).toBe(true)
    for (const complete of [true, false]) expect(parse({ handId: "hand", complete, entries: [entry] }).success).toBe(true)
  })
  it("拒绝私密字段、错误手牌、非法金额和重复序号", () => {
    expect(parse({ handId: "other", complete: true, entries: [entry] }).success).toBe(false)
    expect(parse({ handId: "hand", complete: true, entries: [entry, entry] }).success).toBe(false)
    for (const key of ["note", "userId", "hole", "candidates", "oldCard"]) expect(parse({ handId: "hand", complete: true, entries: [{ ...entry, [key]: "secret" }] }).success).toBe(false)
    for (const amount of [-1, 0.5, Infinity]) expect(parse({ handId: "hand", complete: true, entries: [{ ...entry, amount }] }).success).toBe(false)
  })
})
