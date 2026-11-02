import { describe, expect, it } from "vitest"
import { quoteChipPayment } from "../chips/payment"
import { applyFundedBet, legalFundedActions } from "../chips/funded-betting"
import type { ChipPaymentInput, ChipPaymentModifier } from "../chips/types"
import { startHand } from "../hand-runner"
import { orderedDeck } from "../deck"

const waiver = (cap: number): ChipPaymentModifier => ({ id: "waiver", kind: "waiver", cap })
const input = (nominalAmount: number, extra: Partial<ChipPaymentInput> = {}): ChipPaymentInput => ({ payerId: "a", resource: "chips", purpose: "bet", nominalAmount, balance: 500, revision: "0", ...extra })
const hand = () => {
  const h = startHand([{ seatNo: 0, stack: 501 }, { seatNo: 1, stack: 1000 }], 0, orderedDeck())
  h.actionOnSeat = 0
  return h
}
describe("有限支付与名义下注", () => {
  it("cap_100_on_60_and_300：预演不消费，未用额度不结转", () => {
    const mods = [waiver(100)]
    expect(quoteChipPayment(input(60), mods)).toMatchObject({ nominalAmount: 60, paidAmount: 0, waivedAmount: 60, consumedModifierIds: ["waiver"] })
    expect(quoteChipPayment(input(300), mods).paidAmount).toBe(200)
    expect(mods[0].cap).toBe(100)
    expect(quoteChipPayment(input(0), mods).consumedModifierIds).toEqual([])
  })
  it("combined_spell_cost：基础20与追加20合成一次支付后减免30", () => {
    const q = quoteChipPayment(input(40, { purpose: "card", components: [{ source: "base", amount: 20 }, { source: "tax", amount: 20 }] }), [waiver(30)])
    expect(q).toMatchObject({ nominalAmount: 40, paidAmount: 10, waivedAmount: 30, satisfied: true })
    expect(q.version).toBe(quoteChipPayment(input(40, { purpose: "card", components: [{ source: "base", amount: 20 }, { source: "tax", amount: 20 }] }), [waiver(30)]).version)
    expect(q.version).not.toBe(quoteChipPayment(input(40, { purpose: "card", revision: "1" }), [waiver(30)]).version)
  })
  it("allin_500_plus_100：名义600实付500，全下只由真实余额决定", () => {
    const h = hand(), before = structuredClone(h)
    const q = quoteChipPayment(input(600), [waiver(100)])
    expect(legalFundedActions(h, 0, 100).maxRaiseTo).toBe(601)
    const next = applyFundedBet(h, 0, { action: "allin" }, q)
    expect(next.seats[0]).toMatchObject({ stack: 0, total: 501, nominalTotal: 601, streetBet: 601, allIn: true })
    expect(h).toEqual(before)
  })
  it("call_80_waived：零实付跟注不造成全下", () => {
    const h = hand()
    h.currentBet = 81; h.seats[1].streetBet = 81
    const next = applyFundedBet(h, 0, { action: "call" }, quoteChipPayment(input(80), [waiver(100)]))
    expect(next.seats[0]).toMatchObject({ stack: 500, total: 1, nominalTotal: 81, streetBet: 81, allIn: false })
  })
  it("非下注留一筹码，钻石不豁免；错误金额或不足报价不执行", () => {
    expect(quoteChipPayment(input(500, { purpose: "roll" }), []).satisfied).toBe(false)
    expect(quoteChipPayment(input(500, { purpose: "roll" }), [waiver(1)]).satisfied).toBe(true)
    expect(quoteChipPayment(input(3, { resource: "diamonds" }), [waiver(100)])).toMatchObject({ paidAmount: 3, waivedAmount: 0, consumedModifierIds: [] })
    expect(() => applyFundedBet(hand(), 0, { action: "call" }, quoteChipPayment(input(5), []))).toThrow("POKER_PAYMENT_MISMATCH")
    expect(() => quoteChipPayment(input(-1), [])).toThrow()
    expect(() => quoteChipPayment(input(40, { components: [{ source: "base", amount: 20 }] }), [])).toThrow()
  })
  it("短全下不重开加注权，足额加注才更新最小加注", () => {
    const h = startHand([{ seatNo: 0, stack: 1000 }, { seatNo: 1, stack: 1000 }, { seatNo: 2, stack: 150 }], 0, orderedDeck())
    h.currentBet = 100; h.minRaise = 100; h.actionOnSeat = 2
    h.seats[0].lastActedBet = 100; h.seats[0].streetBet = 100
    const p = h.seats[2]
    const q = quoteChipPayment(input(p.stack, { balance: p.stack }), [])
    const next = applyFundedBet(h, 2, { action: "allin" }, q)
    expect(next.currentBet).toBe(150); expect(next.minRaise).toBe(100)
    next.actionOnSeat = 0
    expect(legalFundedActions(next, 0, 0).actions).not.toContain("raise")
  })
})
