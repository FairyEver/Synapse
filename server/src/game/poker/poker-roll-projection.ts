import type { GamePokerAction, GamePokerHandSeat, GamePokerRoll } from "@prisma/client"
import type { PokerRollPrivateView, PokerRollPublicView, PokerRollView } from "@synapse/shared/game-contracts"
import { quoteRoll, type HandState, type RollHistory } from "./engine/hand-runner"
export function projectRollView(state: HandState, ownSeatNo: number | null): PokerRollView {
  const pending = state.roll?.pending
  return {
    enabled: !!state.ruleOptions?.roll,
    ...(state.rollPricingVersion ? { pricingVersion: state.rollPricingVersion } : {}),
    pendingSeatNo: pending?.seatNo ?? null,
    ...(ownSeatNo !== null ? { ...quoteRoll(state, ownSeatNo), pending: pending?.seatNo === ownSeatNo ? { rollId: pending.id, cardIndex: pending.cardIndex, candidates: [...pending.candidates] } : null } : {}),
  }
}
export function publicRoll(record: GamePokerRoll, action: GamePokerAction, participants: GamePokerHandSeat[]): PokerRollPublicView {
  const r = record.data as unknown as RollHistory, source = action.actionSource
  return { kind: r.kind, phase: action.action === "roll_choose" ? "choose" : "start", fee: r.fee, count: r.count, seatNo: r.seatNo,
    displayName: participants.find(p => p.admissionId === record.admissionId && p.userId === record.userId)?.displayName ?? "选手",
    source: source === "human" || source === "rules_bot" || source === "timeout" ? source : "mcp",
    compensations: { ...r.compensations } }
}
export function privateRoll(record: GamePokerRoll): PokerRollPrivateView {
  const r = record.data as unknown as RollHistory
  return { rollId: r.id, kind: r.kind, cardIndex: r.cardIndex, oldCard: r.oldCard, candidates: [...r.candidates], selectedIndex: r.selectedIndex, fee: r.fee, street: r.street, count: r.count }
}
