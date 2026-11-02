import { describe, expect, it } from "vitest"
import { splitFundedPots } from "../chips/funded-pots"
import { splitPots } from "../pots"
import type { FundedSeat } from "../chips/types"

const seat = (seatNo: number, nominalTotal: number, paidTotal: number, folded = false): FundedSeat => ({ seatNo, nominalTotal, paidTotal, folded })
describe("真实边池", () => {
  it("豁免玩家以名义额度争池，池内仅含真实150", () => {
    const pots = splitFundedPots([seat(0, 100, 0), seat(1, 100, 100), seat(2, 50, 50)], [1, 2, 0])
    expect(pots.map(p => p.amount)).toEqual([100, 50])
    expect(pots.map(p => p.eligible)).toEqual([[0, 1, 2], [0, 1]])
  })
  it("729个无豁免组合退化为原算法", () => {
    for (let a = 1; a <= 9; a++) for (let b = 1; b <= 9; b++) for (let c = 1; c <= 9; c++) {
      const seats = [seat(0, a, a), seat(1, b, b), seat(2, c, c)]
      expect(splitFundedPots(seats, [1, 2, 0])).toEqual(splitPots(seats.map(s => ({ ...s, total: s.paidTotal }))))
    }
  })
  it("逐人最大余数同余优先低层，未匹配只退真实资金", () => {
    expect(splitFundedPots([seat(0, 4, 2), seat(1, 2, 1)], [1, 0])).toEqual([
      { amount: 2, eligible: [0, 1], refund: false }, { amount: 1, eligible: [0], refund: true },
    ])
    expect(splitFundedPots([seat(0, 6, 1), seat(1, 2, 0), seat(2, 4, 0)], [1, 2, 0])).toEqual([{ amount: 1, eligible: [0, 1, 2], refund: false }])
  })
  it("弃牌投入仍分层，零资金不派彩，且任何取整都守恒", () => {
    for (let n = 1; n <= 17; n++) {
      const seats = [seat(0, 17, n, true), seat(1, 9, 4), seat(2, 3, 2)]
      const pots = splitFundedPots(seats, [1, 2, 0])
      expect(pots.reduce((s, p) => s + p.amount, 0)).toBe(n + 6)
      expect(pots.filter(p => !p.refund).every(p => !p.eligible.includes(0))).toBe(true)
    }
    expect(splitFundedPots([seat(0, 100, 0), seat(1, 100, 0)], [0, 1])).toEqual([])
    expect(() => splitFundedPots([seat(0, 1, 2)], [0])).toThrow()
  })
})
