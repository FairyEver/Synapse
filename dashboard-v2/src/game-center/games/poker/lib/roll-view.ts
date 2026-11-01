import type { PokerRollPublicView } from "@synapse/shared/game-contracts"
import { amount } from "./view"
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
