import { z } from "zod"
import { isModernPokerCardRules } from "@synapse/shared/game-contracts"
import type { HandState } from "../hand-runner"
import { after } from "../seat-order"
import type { OperationRegistry } from "../cards/registry"
import { paymentModifiers, consumeEffects } from "../cards/statuses"
import { quoteChipPayment } from "./payment"
import { applyReserveOperation } from "./reserve"
import type { ReserveResult } from "./types"
import { assertHandIntegrity } from "../roll"

export function handParticipants(h: HandState) { return h.participants ?? h.cards?.participants ?? [] }
export function applyHandReserveDelta(h: HandState, result: ReserveResult): void {
  for (const [id, amount] of Object.entries(result.debits)) {
    const participant = handParticipants(h).find(p => p.admissionId === id), seat = h.seats.find(s => s.seatNo === participant?.seatNo)
    if (!seat || seat.stack < amount) throw new Error("POKER_RESERVE_INVALID_PAYER")
    seat.stack -= amount
  }
  for (const [id, amount] of Object.entries(result.credits)) {
    const participant = handParticipants(h).find(p => p.admissionId === id), seat = h.seats.find(s => s.seatNo === participant?.seatNo)
    if (!seat) throw new Error("POKER_RESERVE_INVALID_RECIPIENT")
    seat.stack += amount
    // A previously committed all-in never acquires a new action window.
  }
  h.reserve = result.state
  assertHandIntegrity(h)
}
const emptyReserve = () => ({ revision: 0, lots: [], claims: [], movements: [], finalized: false })
export function registerChipCardOperations(registry: OperationRegistry<HandState>): void {
  registry.register({ id: "chips.pay", schema: z.object({ seatNo: z.number().int(), nominalAmount: z.number().int().nonnegative(), purpose: z.enum(["card", "roll"]), revision: z.string(), version: z.string(), components: z.array(z.object({ source: z.string(), amount: z.number().int().nonnegative() })), surchargeIds: z.array(z.string()) }).strict(), apply(h, input, api) {
    const person = handParticipants(h).find(p => p.seatNo === input.seatNo), seat = h.seats.find(s => s.seatNo === input.seatNo)
    if (!person || !seat) throw new Error("POKER_RESERVE_INVALID_PAYER")
    const quote = quoteChipPayment({ payerId: person.admissionId, resource: "chips", purpose: input.purpose, nominalAmount: input.nominalAmount, balance: seat.stack, revision: input.revision, components: input.components }, paymentModifiers(h, input.seatNo))
    if (quote.version !== input.version || !quote.satisfied) throw new Error("POKER_CARD_PRICE_CHANGED")
    if (h.cards) consumeEffects(h, [...quote.consumedModifierIds, ...input.surchargeIds])
    const intoPot = isModernPokerCardRules(h.cardRulesVersion) && input.purpose === "card"
    if (quote.paidAmount && intoPot) {
      seat.stack -= quote.paidAmount
      const fees = h.mainPotFees ??= {}
      fees[seat.seatNo] = (fees[seat.seatNo] ?? 0) + quote.paidAmount
      assertHandIntegrity(h)
    } else if (quote.paidAmount) {
      const recipients = handParticipants(h).filter(p => p.seatNo !== input.seatNo && h.seats.some(s => s.seatNo === p.seatNo && !s.folded))
      const result = applyReserveOperation(h.reserve ?? emptyReserve(), { kind: "deposit", payer: person, recipients, amount: quote.paidAmount, sourceId: `${api.context.rootActionId}:${input.purpose}`, sourceType: input.purpose }, api.context, after(h.seats.map(s => s.seatNo), h.dealerSeat))
      applyHandReserveDelta(h, result)
      api.emit("chips.deposited", { admissionId: person.admissionId, amount: quote.paidAmount, targetSeatNo: person.seatNo }, "public")
    }
    api.emit("chips.paid", { targetSeatNo: input.seatNo, amount: quote.paidAmount, nominalAmount: quote.nominalAmount, waivedAmount: quote.waivedAmount, ...(intoPot ? { destination: "pot" } : {}) }, "public")
  } })
  registry.register({ id: "chips.steal", schema: z.object({ actorAdmissionId: z.string(), cap: z.number().int().positive(), target: z.enum(["all", "richest"]), targetAdmissionId: z.string().optional(), targetSeatNo: z.number().int().optional(), hostile: z.boolean().optional(), singleTarget: z.boolean().optional() }).strict(), apply(h, input, api) {
    const protections = (h.cards?.effects ?? []).filter(e => e.kind === "theft_guard" && (e.remaining === null || e.remaining > 0)).sort((a, b) => a.installedSeq - b.installedSeq || a.id.localeCompare(b.id))
    const result = applyReserveOperation(h.reserve ?? emptyReserve(), { kind: "steal", ...input, protectedAdmissions: protections.map(e => e.ownerAdmissionId) }, api.context, after(h.seats.map(s => s.seatNo), h.dealerSeat))
    if (h.cards) consumeEffects(h, result.protectedAdmissions.map(id => protections.find(e => e.ownerAdmissionId === id)!.id))
    for (const id of result.protectedAdmissions) api.emit("ability.protected", { targetSeatNo: protections.find(e => e.ownerAdmissionId === id)!.ownerSeatNo }, "public")
    applyHandReserveDelta(h, result)
    api.emit("chips.stolen", { amount: result.amount, status: result.amount ? "completed" : "blocked", targetSeatNo: input.targetSeatNo }, "public")
  } })
  registry.register({ id: "chips.refund", schema: z.object({ actorAdmissionId: z.string(), lotId: z.string(), cap: z.number().int().nonnegative().optional() }).strict(), apply(h, input, api) {
    const result = applyReserveOperation(h.reserve ?? emptyReserve(), { kind: "refund", ...input }, api.context, after(h.seats.map(s => s.seatNo), h.dealerSeat))
    applyHandReserveDelta(h, result)
    api.emit("chips.refunded", { amount: result.amount }, "public")
  } })
}
