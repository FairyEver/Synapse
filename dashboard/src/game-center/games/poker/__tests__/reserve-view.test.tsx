/** @vitest-environment jsdom */
import { act } from "react"
import { createRoot } from "react-dom/client"
import { expect, it } from "vitest"
import type { PokerReserveView } from "@synapse/shared/game-contracts"
import { projectReserveRows, tableReserveView } from "../lib/reserve-view"
import { PokerReserveDialog } from "../components/PokerReserveDialog"
import { tableResponse } from "../../../../../../shared/test/game-response-fixtures"
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
export const reserveFixture: PokerReserveView = { handId: "reserve-hand", status: "pending", total: 0, complete: true,
  players: [{ key: "payer", seatNo: 0, displayName: "付款人", isMe: true, pending: 0 }, { key: "beneficiary", seatNo: 1, displayName: "原待分玩家", isMe: false, pending: 0 }, { key: "thief", seatNo: 2, displayName: "盗取人", isMe: false, pending: 0 }],
  lots: [{ id: "lot", payerKey: "payer", sourceType: "card", originalAmount: 120, remainingAmount: 0, shares: [{ key: "beneficiary", originalAmount: 120, remainingAmount: 0 }] }],
  movements: [{ id: "m1", seq: 0, lotId: "lot", kind: "deposit", amount: 120, actorKey: "payer" }, { id: "m2", seq: 1, lotId: "lot", kind: "steal", amount: 60, actorKey: "thief", recipientKey: "thief" }, { id: "m3", seq: 2, lotId: "lot", kind: "refund", amount: 60, actorKey: "payer", recipientKey: "payer" }] }
it("120存入/60盗取/60退款分别列账且当前暂存为0，筛选不改变来源", async () => {
  const rows = projectReserveRows(reserveFixture, null)
  expect(rows.map(row => [row.kind, row.amount])).toEqual([["deposit", 120], ["steal", 60], ["refund", 60]])
  expect(rows.every(row => row.payerName === "付款人")).toBe(true)
  expect(projectReserveRows(reserveFixture, { beneficiaryKey: "beneficiary" })).toHaveLength(3)
  const host = document.createElement("div"), root = createRoot(host); document.body.append(host)
  try {
    await act(async () => root.render(<PokerReserveDialog table={{ ...tableResponse, handId: reserveFixture.handId, reserve: reserveFixture }} onClose={() => {}} />))
    expect(document.body.textContent).toContain("当前暂存"); expect(document.body.textContent).toContain("盗取 60"); expect(document.body.textContent).toContain("退款 60")
  } finally { await act(async () => root.unmount()); host.remove() }
})
it("截断详情明确不完整，缺源不制造零账", () => {
  expect(projectReserveRows({ ...reserveFixture, movements: [...reserveFixture.movements, { id: "missing", seq: 3, lotId: "not-present", kind: "refund", amount: 2 }] }, null)).toHaveLength(3)
})
it("旧冻结账本适配为暂存来源，状态与历史原数据保持不变", () => {
  const table = { ...tableResponse, handId: "legacy", rollLedger: { handId: "legacy", status: "pending" as const, players: [{ key: "a", seatNo: 0, displayName: "付款人", isMe: true, folded: false }, { key: "b", seatNo: 1, displayName: "收款人", isMe: false, folded: true }], entries: [{ id: "r", seq: 1, payerKey: "a", kind: "normal" as const, street: "preflop" as const, count: 1, fee: 6, compensations: [{ key: "b", amount: 6 }] }] } }
  const before = structuredClone(table), reserve = tableReserveView(table)!
  expect(reserve.total).toBe(6); expect(reserve.players.find(p => p.key === "b")!.pending).toBe(6)
  expect(projectReserveRows(reserve, null)).toMatchObject([{ kind: "deposit", amount: 6, sourceType: "roll" }]); expect(table).toEqual(before)
})
