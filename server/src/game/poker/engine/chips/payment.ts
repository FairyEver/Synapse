import { createHash } from "node:crypto"
import type { ChipPaymentInput, ChipPaymentModifier, ChipPaymentQuote } from "./types"

function money(n: number): void {
  if (!Number.isSafeInteger(n) || n < 0) throw new Error("POKER_INVALID_PAYMENT")
}
/** A preview is pure; only a committed positive payment consumes the reported modifiers. */
export function quoteChipPayment(input: ChipPaymentInput, modifiers: readonly ChipPaymentModifier[]): ChipPaymentQuote {
  money(input.nominalAmount); money(input.balance)
  const ids = new Set<string>()
  for (const modifier of modifiers) {
    money(modifier.cap)
    if (!modifier.id || ids.has(modifier.id) || modifier.kind !== "waiver") throw new Error("POKER_INVALID_PAYMENT")
    ids.add(modifier.id)
  }
  if (input.components) {
    for (const component of input.components) money(component.amount)
    if (input.components.reduce((n, c) => n + c.amount, 0) !== input.nominalAmount) throw new Error("POKER_INVALID_PAYMENT")
  }
  let remaining = input.nominalAmount, capacity = 0
  const consumedModifierIds: string[] = []
  if (input.resource === "chips") for (const modifier of modifiers) {
    capacity += modifier.cap
    if (remaining > 0 && modifier.cap > 0) {
      remaining -= Math.min(remaining, modifier.cap)
      consumedModifierIds.push(modifier.id)
    }
  }
  const retained = input.resource === "chips" && input.purpose !== "bet" && input.purpose !== "blind" ? 1 : 0
  const maximumNominalAmount = Math.max(0, input.balance - retained) + capacity
  money(maximumNominalAmount)
  const version = createHash("sha256").update(JSON.stringify([input, modifiers])).digest("hex").slice(0, 32)
  return { nominalAmount: input.nominalAmount, waivedAmount: input.nominalAmount - remaining, paidAmount: remaining,
    consumedModifierIds, version, satisfied: remaining <= input.balance - retained || input.nominalAmount === 0, maximumNominalAmount }
}
