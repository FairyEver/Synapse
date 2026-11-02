import type { PokerRollOffer, PokerRollPublicView } from "@synapse/shared/game-contracts"
import { amount } from "./view"
export function rollOfferCost(offer: PokerRollOffer | undefined, unit: string) {
  return `${offer?.coinCost != null ? `${offer.coinCost} 钻石 + ` : ""}${amount(offer?.fee ?? 0)} ${unit}`
}
export function rollUnavailableReason(offer: PokerRollOffer | undefined, balance: number | undefined, unit: string) {
  if (offer?.available) return null
  if (offer?.reason === "POKER_ROLL_INSUFFICIENT_COINS") return balance === 0 ? "本手钻石已用完" : `钻石不足，需 ${offer.coinCost}`
  if (offer?.reason === "POKER_ROLL_INSUFFICIENT_STACK") return `${unit}不足，支付后需至少保留 1 ${unit}`
  if (offer?.reason === "POKER_ROLL_STREET_INVALID") return "当前阶段不能换牌"
  if (offer?.reason === "POKER_ROLL_NOT_YOUR_TURN") return "当前不能换牌"
  return "不可用"
}
export function rollEventLabel(event: PokerRollPublicView) {
  const kind = event.kind === "super" ? "超级换牌" : "普通换牌"
  return event.phase === "start" ? `${event.displayName} · ${kind} · 支出 ${amount(event.fee)}` : `${event.displayName} · 已完成${kind}`
}
export function rollAmounts(history: readonly PokerRollPublicView[] | undefined, seatNo: number) {
  return (history ?? []).filter(event => event.phase === "start").reduce((total,event) => ({
    paid:total.paid + (event.seatNo === seatNo ? event.fee : 0),
    received:total.received + (event.compensations[String(seatNo)] ?? 0),
  }),{paid:0,received:0})
}
