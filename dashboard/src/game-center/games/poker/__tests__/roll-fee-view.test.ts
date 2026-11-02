import { describe, expect, it } from "vitest"
import { summarizeRollLedger, selectRollLedgerEntries } from "../lib/roll-ledger"
import { feeLedger } from "./roll-fee-fixtures"

describe("Roll费用公开账本视图", () => {
  it("独立聚合来源及去向，均为403；没有支付的接收者不混入来源", () => {
    const result = summarizeRollLedger(feeLedger)
    expect(result.total).toBe(403)
    expect(result.sources.map(row => [row.key, row.amount, row.count])).toEqual([["lin", 220, 2], ["man", 120, 1], ["chuan", 63, 1]])
    expect(result.destinations.map(row => [row.key, row.amount])).toEqual([["momo", 121], ["chuan", 100], ["man", 91], ["lin", 51], ["chen", 40]])
    expect(result.destinations.reduce((sum, row) => sum + row.amount, 0)).toBe(403)
  })
  it("收入筛选显示个人每笔补偿，保留原流水序号，弃牌不撤回旧收入", () => {
    const received = selectRollLedgerEntries(feeLedger, { direction: "destination", key: "chen" })
    expect(received.map(row => [row.index, row.amount])).toEqual([[1, 10], [2, 30]])
    expect(selectRollLedgerEntries(feeLedger, { direction: "source", key: "lin" }).map(row => [row.index, row.amount])).toEqual([[1, 40], [4, 180]])
    expect(selectRollLedgerEntries(feeLedger, null)).toHaveLength(4)
  })
  it("已知空账本为零；同名/同座不同身份不合并", () => {
    expect(summarizeRollLedger({ ...feeLedger, entries: [] })).toEqual({ total: 0, sources: [], destinations: [] })
    const ledger = { ...feeLedger, players: feeLedger.players.map(player => ({ ...player, displayName: "同名", seatNo: 0 })) }
    expect(summarizeRollLedger(ledger).sources).toHaveLength(3)
    expect(summarizeRollLedger(ledger).destinations).toHaveLength(5)
  })
})
