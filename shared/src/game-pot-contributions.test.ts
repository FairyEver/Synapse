import { describe, expect, it } from "vitest"
import { GAME_RESPONSE_SCHEMAS } from "./game-response-schemas"
import { tableResponse } from "../test/game-response-fixtures"

const contributions = {
  handId: "hand", status: "pending", total: 4,
  players: [
    { key: "p0", seatNo: 0, displayName: "原玩家", isMe: true, folded: false, amount: 3 },
    { key: "p1", seatNo: 1, displayName: "弃牌玩家", isMe: false, folded: true, amount: 1 },
  ],
}
for (const operation of ["app.game.poker.table.state", "app.game.poker.room.get"]) describe(`${operation}底池来源契约`, () => {
  const schema = GAME_RESPONSE_SCHEMAS[operation]
  const parse = (potContributions: unknown) => schema.safeParse({ ...tableResponse, potContributions })
  it("旧响应兼容，严格允许公开来源及结算/取消累计投入", () => {
    expect(schema.safeParse(tableResponse).success).toBe(true)
    for (const status of ["pending", "settled", "cancelled"]) expect(parse({ ...contributions, status }).success).toBe(true)
    for (const privateField of ["userId", "admissionId", "hole", "note", "candidates"]) {
      expect(parse({ ...contributions, [privateField]: "secret" }).success).toBe(false)
      expect(parse({ ...contributions, players: [{ ...contributions.players[0], [privateField]: "secret" }, contributions.players[1]] }).success).toBe(false)
    }
  })
  it("金额必须为安全非负整数且合计严格守恒，非法小数不使safeParse抛错", () => {
    for (const amount of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => parse({ ...contributions, players: [{ ...contributions.players[0], amount }, contributions.players[1]] })).not.toThrow()
      expect(parse({ ...contributions, players: [{ ...contributions.players[0], amount }, contributions.players[1]] }).success).toBe(false)
      expect(parse({ ...contributions, total: amount }).success).toBe(false)
    }
    expect(parse({ ...contributions, total: 5 }).success).toBe(false)
    expect(parse({ ...contributions, total: 0, players: [] }).success).toBe(true)
  })
  it("拒绝重复key/座位/本人、错误手牌和超过10个玩家", () => {
    for (const change of [{ key: "p0" }, { seatNo: 0 }, { isMe: true }, { seatNo: 10 }, { key: "" }])
      expect(parse({ ...contributions, players: [contributions.players[0], { ...contributions.players[1], ...change }] }).success).toBe(false)
    expect(parse({ ...contributions, handId: "other-hand" }).success).toBe(false)
    expect(parse({ ...contributions, players: Array.from({ length: 11 }, (_, seatNo) => ({ ...contributions.players[0], key: `p${seatNo}`, seatNo, isMe: false, amount: 0 })), total: 0 }).success).toBe(false)
  })
})
