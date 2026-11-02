import { createHash } from "node:crypto"
import type { GamePokerAction, GamePokerHandSeat } from "@prisma/client"
import type { PokerPotContributions } from "@synapse/shared/game-contracts"
import type { HandState } from "./engine/hand-runner"
import { resolveRules } from "./engine/rules"
import { seatOrder } from "./engine/seat-order"

interface PotContributionsInput {
  roomId: string
  userId: string
  hand: { id: string; status: string; dealerSeat: number; rules: unknown; actionSeq: number }
  participants: readonly Pick<GamePokerHandSeat, "handId" | "seatNo" | "userId" | "admissionId" | "displayName" | "folded" | "startingStack">[]
  state?: HandState | null
  archivedActions?: readonly Pick<GamePokerAction, "handId" | "roomId" | "userId" | "seq" | "seatNo" | "amount" | "action">[]
}
const amountIsValid = (amount: number) => Number.isSafeInteger(amount) && amount >= 0

/** Public immutable hand identities only; absent/corrupt sources never become a partial zero. */
export function projectPotContributions(input: PotContributionsInput): PokerPotContributions | undefined {
  const { roomId, userId, hand, participants, state, archivedActions } = input
  const funded = state?.chipRulesVersion === "chips-v2" || !!hand.rules && typeof hand.rules === "object" && "chipRulesVersion" in hand.rules && hand.rules.chipRulesVersion === "chips-v2"
  if (!hand.id || participants.length < 2 || participants.length > 10 || participants.some(player =>
    !player || player.handId !== hand.id || !player.userId || !Number.isInteger(player.seatNo) || player.seatNo < 0 || player.seatNo > 9 ||
    typeof player.displayName !== "string" || typeof player.folded !== "boolean" || !amountIsValid(player.startingStack) || player.startingStack === 0) ||
    new Set(participants.map(player => player.seatNo)).size !== participants.length ||
    new Set(participants.map(player => player.userId)).size !== participants.length) return undefined

  const amounts = new Map<number, number>()
  if (state) {
    if (!Array.isArray(state.seats) || state.seats.some(seat => !seat) || state.seats.length !== participants.length || new Set(state.seats.map(seat => seat.seatNo)).size !== participants.length) return undefined
    for (const player of participants) {
      const seat = state.seats.find(seat => seat.seatNo === player.seatNo)
      if (!seat || seat.startingStack !== player.startingStack || !amountIsValid(seat.total) || !funded && seat.total > player.startingStack || typeof seat.folded !== "boolean") return undefined
      amounts.set(player.seatNo, seat.total)
    }
  } else {
    if (!archivedActions || !Number.isSafeInteger(hand.actionSeq) || hand.actionSeq < 0 || archivedActions.length !== hand.actionSeq || archivedActions.some(action => !action)) return undefined
    let blinds: [number, number][]
    try {
      // Historical snapshots without rules retain the engine's original 1/2 default.
      if (hand.rules !== undefined && hand.rules !== null && (typeof hand.rules !== "object" || Array.isArray(hand.rules))) return undefined
      const rules = resolveRules((hand.rules ?? {}) as Parameters<typeof resolveRules>[0])
      const order = seatOrder(participants.map(player => player.seatNo), hand.dealerSeat)
      blinds = [[order.smallBlind, rules.smallBlind], [order.bigBlind, rules.bigBlind]]
    } catch {
      // Invalid archived rules/seat order make this optional projection unavailable.
      return undefined
    }
    for (const player of participants) amounts.set(player.seatNo, 0)
    for (const [seatNo, blind] of blinds) amounts.set(seatNo, Math.min(participants.find(player => player.seatNo === seatNo)!.startingStack, blind))
    const ordered = [...archivedActions].sort((a, b) => a.seq - b.seq)
    for (const [index, action] of ordered.entries()) {
      const player = participants.find(player => player.seatNo === action.seatNo)
      if (action.seq !== index + 1 || action.handId !== hand.id || action.roomId !== roomId || !player || action.userId !== player.userId || !amountIsValid(action.amount)) return undefined
      if (["roll_start", "roll_choose", "card_play", "card_choose"].includes(action.action)) {
        if (action.amount !== 0) return undefined
        continue
      }
      if (!["fold", "check", "call", "bet", "raise", "allin"].includes(action.action) ||
          (["fold", "check"].includes(action.action) && action.amount !== 0)) return undefined
      const amount = amounts.get(player.seatNo)! + action.amount
      if (!amountIsValid(amount) || !funded && amount > player.startingStack) return undefined
      amounts.set(player.seatNo, amount)
    }
  }
  const players = participants.map(player => ({
    key: createHash("sha256").update(JSON.stringify([roomId, player.userId])).digest("hex"),
    seatNo: player.seatNo, displayName: player.displayName, isMe: player.userId === userId,
    folded: state?.seats.find(seat => seat.seatNo === player.seatNo)?.folded ?? player.folded,
    amount: amounts.get(player.seatNo)!,
  }))
  const total = players.reduce((sum, player) => sum + BigInt(player.amount), 0n)
  if (total === 0n || total > BigInt(Number.MAX_SAFE_INTEGER)) return undefined
  return { handId: hand.id, status: hand.status === "cancelled" ? "cancelled" : hand.status === "settled" ? "settled" : "pending", total: Number(total), players }
}
