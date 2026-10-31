import { describe, expect, it } from "vitest"
import { recordStreets } from "../lib/record-streets"
describe("记录逐街公共牌", () => {
  it("全下自动跑完也依次展示翻牌、转牌、河牌，不提前揭示后续牌", () => {
    const rows = recordStreets(["As", "Kh", "7d", "2s", "3c"], [])
    expect(rows.map((s) => s.board.length)).toEqual([0, 3, 4, 5])
    expect(rows.map((s) => s.label)).toEqual(["翻牌前", "翻牌", "转牌", "河牌"])
  })
  it("翻牌前结束不制造未发的街道，动作按街道和seq排序", () => {
    const moves = [2, 1].map((seq) => ({
      seq,
      street: "preflop",
      seatNo: 0,
      action: "check",
      amount: 0,
      potAfter: 3,
      isAuto: false,
    }))
    const rows = recordStreets([], moves)
    expect(rows).toHaveLength(1)
    expect(rows[0].actions.map((a) => a.seq)).toEqual([1, 2])
  })
})
