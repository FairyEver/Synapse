import { describe, expect, it } from "vitest"
import { GAME_RESPONSE_SCHEMAS } from "./game-response-schemas"
import { tableResponse } from "../test/game-response-fixtures"

const ledger = {
  handId: "hand", status: "pending",
  players: [
    { key: "a", seatNo: 0, displayName: "甲", isMe: true, folded: false },
    { key: "b", seatNo: 1, displayName: "乙", isMe: false, folded: true },
  ],
  entries: [40, 120, 63, 180].map((fee, i) => ({ id: `r${i}`, payerKey: "a", kind: "normal", street: "preflop", fee, compensations: [{ key: "b", amount: fee }] })),
}
const schema = GAME_RESPONSE_SCHEMAS["app.game.poker.table.state"]!
const accepts = (value: unknown) => schema.safeParse({ ...tableResponse, rollLedger: value }).success

describe("Roll费用公开账本契约", () => {
  it("接收全部403费用、空账本与旧响应，以及三种资金状态", () => {
    expect(accepts(ledger)).toBe(true)
    expect(schema.safeParse(tableResponse).success).toBe(true)
    expect(accepts({ ...ledger, entries: [] })).toBe(true)
    for (const status of ["pending", "released", "cancelled"]) expect(accepts({ ...ledger, status })).toBe(true)
  })
  it.each(["userId", "admissionId", "hole", "oldCard", "candidates", "cardIndex", "persona", "note"])("拒绝任何层级的私密字段%s", field => {
    expect(accepts({ ...ledger, [field]: "private" })).toBe(false)
    expect(accepts({ ...ledger, players: [{ ...ledger.players[0], [field]: "private" }, ledger.players[1]] })).toBe(false)
    expect(accepts({ ...ledger, entries: [{ ...ledger.entries[0], [field]: "private" }] })).toBe(false)
    expect(accepts({ ...ledger, entries: [{ ...ledger.entries[0], compensations: [{ key: "b", amount: 40, [field]: "private" }] }] })).toBe(false)
  })
  it.each([-1, 0, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])("拒绝非法费用%s", fee => {
    expect(accepts({ ...ledger, entries: [{ ...ledger.entries[0], fee }] })).toBe(false)
  })
  it.each([-1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])("非法补偿%s以验证失败返回而不抛异常", amount => {
    expect(accepts({ ...ledger, entries: [{ ...ledger.entries[0], compensations: [{ key: "b", amount }] }] })).toBe(false)
  })
  it("拒绝错误外键、重复身份与重复收费记录及不守恒分配", () => {
    expect(accepts({ ...ledger, entries: [{ ...ledger.entries[0], payerKey: "missing" }] })).toBe(false)
    expect(accepts({ ...ledger, entries: [{ ...ledger.entries[0], compensations: [{ key: "missing", amount: 40 }] }] })).toBe(false)
    expect(accepts({ ...ledger, entries: [{ ...ledger.entries[0], compensations: [{ key: "a", amount: 40 }] }] })).toBe(false)
    expect(accepts({ ...ledger, entries: [{ ...ledger.entries[0], compensations: [{ key: "b", amount: 39 }] }] })).toBe(false)
    expect(accepts({ ...ledger, entries: [{ ...ledger.entries[0], compensations: [{ key: "b", amount: 20 }, { key: "b", amount: 20 }] }] })).toBe(false)
    expect(accepts({ ...ledger, players: [ledger.players[0], ledger.players[0]] })).toBe(false)
    expect(accepts({ ...ledger, players: [ledger.players[0], { ...ledger.players[1], seatNo: 0 }] })).toBe(false)
    expect(accepts({ ...ledger, entries: [ledger.entries[0], ledger.entries[0]] })).toBe(false)
  })
})
