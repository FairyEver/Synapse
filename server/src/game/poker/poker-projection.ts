import type { GamePokerAction, GamePokerHand, GamePokerHandSeat } from "@prisma/client"
import type { PokerSettlementView } from "@synapse/shared/game-contracts"
import type { ArchivedHand } from "./poker-archive.service"
import { bestFive, compareHands, handRankName } from "./engine/hand"
import { settlementReason } from "./settlement-reason"
import { resolveRules, type PokerRules } from "./engine/rules"

export type PokerViewPolicy = {
  audience: "desktop" | "decision"
  perspective: "owner" | "public"
  everJoined: boolean
  mode: string
  cardMode?: boolean
}
export function canSeeHole(
  userId: string,
  targetUserId: string,
  participantKind: string,
  folded: boolean,
  shown: boolean,
  participating: boolean,
  policy: PokerViewPolicy,
): boolean {
  if (policy.audience === "desktop" && policy.perspective === "public") {
    if (!policy.everJoined) return true
    if (policy.mode === "practice" && participantKind === "bot") return true
  }
  return (policy.perspective === "owner" && userId === targetUserId && !(policy.cardMode && policy.audience === "decision")) ||
    (participating && shown && !folded)
}
const object = (value: unknown): Record<string, any> =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {}
const strings = (value: unknown): string[] => Array.isArray(value) ? value.filter((c): c is string => typeof c === "string") : []
const numbers = (value: unknown): number[] => Array.isArray(value) ? value.filter((c): c is number => Number.isSafeInteger(c)) : []
const amount = (value: unknown, fallback = 0): number => Number.isSafeInteger(value) ? value as number : fallback
export function publicHandResult(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value
  const record = value as Record<string, unknown>
  return Object.fromEntries(["payouts", "pots", "deltas", "rollPaid", "rollReceived", "reservePaid", "reserveReceived", "reserveStolen", "reserveRefunded"].filter(key => key in record).map(key => [key, record[key]]))
}
export function projectSettlement(
  hand: GamePokerHand | ArchivedHand["hand"],
  participants: GamePokerHandSeat[],
  actions: GamePokerAction[],
  userId: string,
  policy: PokerViewPolicy,
): PokerSettlementView | null {
  if (hand.status !== "settled") return null
  const result = object(hand.result), payouts = object(result.payouts), deltas = object(result.deltas)
  const saved = object(hand.rules), state = "engineState" in hand ? object(hand.engineState) : {}
  const rules = resolveRules({ ...state, ...saved } as Partial<PokerRules>)
  const effectivePolicy = { ...policy, cardMode: !!rules.ruleOptions?.cards }
  const board = strings(hand.board), shown = numbers(hand.showdownSeats)
  const participating = participants.some((s) => s.userId === userId)
  const controlSources = new Map<string, Set<string>>()
  for (const action of actions) {
    const key = JSON.stringify([action.userId, action.seatNo])
    const sources = controlSources.get(key) ?? new Set<string>()
    sources.add(action.actionSource ?? (action.isAuto ? "timeout" : "mcp"))
    controlSources.set(key, sources)
  }
  const settlement: PokerSettlementView = {
    handId: hand.id,
    handNo: hand.handNo,
    board,
    rules,
    seats: participants.map((s) => {
      const hole = strings(s.holeCards)
      const visible = canSeeHole(userId, s.userId, s.participantKind ?? "human", s.folded, shown.includes(s.seatNo), participating, effectivePolicy)
      const endingStack = amount(s.endingStack, s.startingStack + amount(deltas[s.seatNo]))
      return {
        seatNo: s.seatNo,
        displayName: s.displayName,
        participantKind: s.participantKind === "bot" ? "bot" : "human",
        isMe: s.userId === userId,
        folded: s.folded,
        delta: amount(deltas[s.seatNo], endingStack - s.startingStack),
        payout: amount(payouts[s.seatNo]),
        ...(rules.ruleOptions?.roll ? { rollPaid: amount(object(result.rollPaid)[s.seatNo]), rollReceived: amount(object(result.rollReceived)[s.seatNo]), pokerDelta: amount(deltas[s.seatNo], endingStack - s.startingStack) + amount(object(result.rollPaid)[s.seatNo]) - amount(object(result.rollReceived)[s.seatNo]) } : {}),
        ...(rules.chipRulesVersion === "chips-v2" ? { reservePaid: amount(object(result.reservePaid)[s.seatNo]), reserveReceived: amount(object(result.reserveReceived)[s.seatNo]), reserveStolen: amount(object(result.reserveStolen)[s.seatNo]), reserveRefunded: amount(object(result.reserveRefunded)[s.seatNo]),
          pokerDelta: amount(deltas[s.seatNo], endingStack - s.startingStack) + amount(object(result.reservePaid)[s.seatNo]) - amount(object(result.reserveReceived)[s.seatNo]) - amount(object(result.reserveStolen)[s.seatNo]) - amount(object(result.reserveRefunded)[s.seatNo]) } : {}),
        endingStack,
        ...(visible ? { hole } : {}),
        ...(visible && !s.folded && board.length + hole.length >= 5 ? { handName: handRankName([...hole, ...board], rules.variant), bestFive: bestFive([...hole, ...board], rules.variant) } : {}),
      }
    }),
    pots: (Array.isArray(result.pots) ? result.pots : []).map((entry: unknown) => {
      const pot = object(entry), shares = object(pot.shares)
      return {
        amount: amount(pot.amount),
        eligible: numbers(pot.eligible),
        winners: numbers(pot.winners),
        shares: Object.fromEntries(Object.entries(shares).filter(([seat, value]) => /^\d+$/.test(seat) && Number.isSafeInteger(value) && value >= 0)),
        refund: pot.refund === true,
      }
    }),
    mixedControl: [...controlSources.values()].some((sources) => sources.has("human") && sources.has("mcp")),
  }
  // Sort only the visible projection so hidden cards cannot leak through row order.
  settlement.seats.sort((a, b) => {
    if (a.bestFive && b.bestFive) return compareHands(b.bestFive, a.bestFive, rules.variant)
    return Number(!!b.bestFive) - Number(!!a.bestFive) || Number(!!b.hole?.length) - Number(!!a.hole?.length)
  })
  settlement.pots = settlement.pots.map(pot => ({ ...pot, reason: settlementReason(pot, settlement) }))
  return settlement
}
