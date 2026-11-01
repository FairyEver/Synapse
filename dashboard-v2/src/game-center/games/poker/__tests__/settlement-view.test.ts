import { expect, it } from "vitest"
import { invested, readinessView, settlementView } from "../lib/settlement-view"
import { table } from "./settlement-fixture"
it("平分同一底池和分别赢主边池使用不同结果说明", () => {
  const settlement = { ...table.settlement!, pots: [{ ...table.settlement!.pots[0], winners: [0, 1] }] }
  expect(settlementView(settlement).title).toContain("平分底池")
  expect(settlementView({ ...settlement, pots: [{ ...settlement.pots[0], winners: [0] }, { ...settlement.pots[0], winners: [1] }] }).title).toContain("分别收池")
})
it("收回减净变化才是投入，返还不计入底池总额，历史座位不计入准备", () => {
  const s = table.settlement!
  expect(invested(s.seats[0])).toBe(600)
  expect(settlementView({ ...s, pots: [...s.pots, { ...s.pots[0], amount: 100, refund: true }] }).total).toBe(1200)
  expect(readinessView({ ...table, seats: [...table.seats, { ...table.seats[0], seatNo: 9, isHistorical: true, readyForNextHand: true }] }).seats).toHaveLength(2)
})
