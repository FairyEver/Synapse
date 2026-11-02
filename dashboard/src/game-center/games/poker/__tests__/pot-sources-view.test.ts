import { describe, expect, it } from "vitest"
import { potSourcesView } from "../lib/pot-sources"
import { potContributions, potTable } from "./pot-sources-fixture"

describe("底池来源展示", () => {
  it("按真实累计投入展示300的来源占比，弃牌的50仍保留，零投入不计来源", () => {
    const view = potSourcesView(potTable)!
    expect(view.total).toBe(300)
    expect(view.players.map(player => [player.key, player.amount, player.percentage])).toEqual([["lin", 150, "50.0"], ["man", 100, "33.3"], ["chen", 50, "16.7"]])
    expect(view.players[2].folded).toBe(true)
    expect(view.players.reduce((total, player) => total + player.amount, 0)).toBe(300)
    expect(potTable.rollLedger?.entries.reduce((total, entry) => total + entry.fee, 0)).toBe(403)
  })
  it("缺源/迟到响应不伪造零，已知空底池不除以零；结算不从当前余额重算", () => {
    expect(potSourcesView({ ...potTable, potContributions: undefined })).toBeUndefined()
    expect(potSourcesView({ ...potTable, handId: "next" })).toBeUndefined()
    expect(potSourcesView({ ...potTable, potContributions: { ...potContributions, total: 0, players: [] } })?.players).toEqual([])
    expect(potSourcesView({ ...potTable, pot: 0, potContributions: { ...potContributions, status: "settled" } })?.total).toBe(300)
  })
})
