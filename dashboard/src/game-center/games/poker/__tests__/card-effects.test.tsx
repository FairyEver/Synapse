/** @vitest-environment jsdom */
import { act } from "react"
import { createRoot } from "react-dom/client"
import { expect, it } from "vitest"
import type { PokerResolutionFrameView, PokerTableView } from "@synapse/shared/game-contracts"
import { chipValue } from "@synapse/shared/game-contracts"
import { tableResponse } from "../../../../../../shared/test/game-response-fixtures"
import { seedChipPresentation, updateChipPresentation, activeChipTransfers, startChipTransfer, finishChipTransfer } from "../lib/chip-presentation"
import { mergeCardFrames } from "../lib/card-effects"
import { PokerCardStatuses } from "../components/PokerCardStatuses"
import { Seat } from "../components/Seat"
import { betPaymentPreview } from "../lib/action-view"
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
const base: PokerTableView = { ...tableResponse, handId: "funded-h", actionSeq: 1, pot: 0, chipState: { pot: [], roll: [], reserve: [], recent: [] }, seats: [{ seatNo: 0, displayName: "我", stack: 200, streetBet: 0, status: "active", aiState: "online", isMe: true }] }
it("名义100实付0不飞筹码，也不把名义数额当底池", () => {
  expect(betPaymentPreview({ ...base, betWaiverCap: 60 }, 100)).toEqual({ nominalAmount: 100, waivedAmount: 60, paidAmount: 40 })
  const next = { ...base, actionSeq: 2, recentActions: [{ seq: 2, seatNo: 0, street: "flop", action: "call", amount: 0, nominalAmount: 100, waivedAmount: 100 }], chipState: { ...base.chipState!, recent: [{ id: "zero", seq: 2, seatNo: 0, amount: 0, fund: "pot" as const, direction: "in" as const, kind: "bet" as const }] } }
  expect(updateChipPresentation(seedChipPresentation(base, "c"), next, "c").transfers.reduce((sum, t) => sum + t.amount, 0)).toBe(0)
})
it("根内存入/盗取/退款按顺序；重复快照及重复落地不再记账", () => {
  const next: PokerTableView = { ...base, actionSeq: 2, chipState: { pot: [], roll: [], reserve: [], recent: [{ id: "deposit", seq: 2, seatNo: 0, amount: 120, fund: "reserve", direction: "in", kind: "card" }, { id: "steal", seq: 2, seatNo: 0, amount: 60, fund: "reserve", direction: "out", kind: "steal" }, { id: "refund", seq: 2, seatNo: 0, amount: 60, fund: "reserve", direction: "out", kind: "refund" }] } }
  let state = updateChipPresentation(seedChipPresentation(base, "c"), next, "c")
  expect(activeChipTransfers(state).map(t => t.id)).toEqual(["deposit"])
  state = finishChipTransfer(startChipTransfer(state, "deposit"), "deposit"); expect(chipValue(state.funds.roll)).toBe(120)
  expect(activeChipTransfers(state).map(t => t.id)).toEqual(["steal"])
  state = finishChipTransfer(startChipTransfer(state, "steal"), "steal"); expect(chipValue(state.funds.roll)).toBe(60)
  state = finishChipTransfer(startChipTransfer(state, "refund"), "refund"); expect(chipValue(state.funds.roll)).toBe(0)
  expect(state.banks[0]).toBe(200); expect(updateChipPresentation(state, next, "c").transfers).toEqual([])
})
it("根帧按完整根去重，重连基线不重播", () => {
  const frame: PokerResolutionFrameView = { id: "f", handId: "h", seq: 2, events: [{ index: 0, type: "ability.played", cardId: "01", actorSeatNo: 0 }, { index: 1, type: "ability.blocked", cardId: "43", targetSeatNo: 1 }] }
  const first = mergeCardFrames([], [frame], false)
  expect(first.animate).toEqual([frame]); expect(mergeCardFrames(first.frames, [frame], false).animate).toEqual([])
  expect(mergeCardFrames([], [frame], true).animate).toEqual([])
})
it("公开单张牌只显示指定实体位置；状态与历史使用记录不混淆", async () => {
  const seat = { ...base.seats[0], hole: undefined, publicHole: [{ index: 1, card: "Qh" }] }
  const host = document.createElement("div"), root = createRoot(host); document.body.append(host)
  try {
    await act(async () => root.render(<><Seat seat={seat} maxSeats={2} acting={false} dealer={false} dealt deadlineMs={0} /><PokerCardStatuses cards={{ enabled: true, version: "cards-v1", used: [{ id: "played", cardId: "15", name: "公开牌", seatNo: 0, seq: 1, status: "completed" }], statuses: [{ id: "marker", cardId: "15", title: "公开牌", seatNo: 0, polarity: "negative", dispellable: true }] }} /></>))
    expect(document.querySelectorAll('.poker-seat-cards [data-face="down"]')).toHaveLength(1); expect(document.querySelector('[data-card="Qh"]')).not.toBeNull()
    await act(async () => root.render(<PokerCardStatuses cards={{ enabled: true, version: "cards-v1", used: [{ id: "played", cardId: "15", name: "公开牌", seatNo: 0, seq: 1, status: "completed" }], statuses: [] }} />))
    expect(document.body.textContent).toContain("已使用"); expect(document.querySelector('[data-status-id="marker"]')).toBeNull()
  } finally { await act(async () => root.unmount()); host.remove() }
})
