import { createHash } from "node:crypto"
import type { GamePokerAction, GamePokerHandSeat, GamePokerRoll } from "@prisma/client"
import type { PokerRollLedger, PokerRollLedgerEntry } from "@synapse/shared/game-contracts"
import type { HandState, RollHistory } from "./engine/hand-runner"

interface RollLedgerInput {
  roomId: string
  userId: string
  hand: { id: string; status: string; rules?: unknown }
  participants: readonly Pick<GamePokerHandSeat, "seatNo" | "userId" | "admissionId" | "displayName" | "folded">[]
  state?: HandState | null
  archivedRolls?: readonly GamePokerRoll[]
  archivedActions?: readonly Pick<GamePokerAction, "action" | "rollId">[]
}

/** Public whitelist only. Missing source/identity means unavailable, never a partial zero ledger. */
export function projectRollLedger(input: RollLedgerInput): PokerRollLedger | undefined {
  const { roomId, userId, hand, participants, state, archivedRolls, archivedActions } = input
  if (state?.chipRulesVersion === "chips-v2" || hand.rules && typeof hand.rules === "object" && "chipRulesVersion" in hand.rules && hand.rules.chipRulesVersion === "chips-v2") return undefined
  let history: readonly RollHistory[]
  if (state?.roll && Array.isArray(state.roll.history)) history = state.roll.history
  else if (archivedRolls) {
    const ordered = [...archivedRolls].sort((a, b) => a.startSeq - b.startSeq || new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime() || a.id.localeCompare(b.id))
    if (ordered.some(record => record.handId !== hand.id || record.roomId !== roomId || !participants.some(player =>
      player.seatNo === record.seatNo && player.userId === record.userId && player.admissionId === record.admissionId))) return undefined
    if (archivedActions) {
      const starts = new Set(archivedActions.filter(action => action.action === "roll_start").map(action => action.rollId))
      const ids = new Set(ordered.map(record => record.id))
      if (starts.size !== ids.size || [...starts].some(id => !id || !ids.has(id))) return undefined
    }
    history = ordered.map(record => record.data as unknown as RollHistory)
    if (history.some((record, i) => !record || record.id !== ordered[i].id || record.seatNo !== ordered[i].seatNo)) return undefined
  } else return undefined

  const players = participants.map(player => ({
    key: createHash("sha256").update(JSON.stringify([roomId, player.userId])).digest("hex"),
    seatNo: player.seatNo, displayName: player.displayName, isMe: player.userId === userId,
    folded: state?.seats.find(seat => seat.seatNo === player.seatNo)?.folded ?? player.folded,
  }))
  const bySeat = new Map(players.map(player => [player.seatNo, player.key]))
  if (players.length > 10 || bySeat.size !== players.length || new Set(players.map(player => player.key)).size !== players.length) return undefined
  const seen = new Set<string>(), entries: PokerRollLedgerEntry[] = []
  for (const record of history) {
    if (!record || !record.id || !Number.isSafeInteger(record.fee) || record.fee <= 0 ||
        !["normal", "super"].includes(record.kind) || !["preflop", "flop", "turn"].includes(record.street) ||
        !record.compensations || typeof record.compensations !== "object") return undefined
    if (seen.has(record.id)) continue
    seen.add(record.id)
    const payerKey = bySeat.get(record.seatNo)
    if (!payerKey) return undefined
    const compensations: PokerRollLedgerEntry["compensations"] = []
    for (const [seatNo, amount] of Object.entries(record.compensations)) {
      const key = bySeat.get(Number(seatNo))
      if (!key || key === payerKey || !Number.isSafeInteger(amount) || amount < 0 || compensations.some(recipient => recipient.key === key)) return undefined
      compensations.push({ key, amount })
    }
    if (compensations.reduce((sum, recipient) => sum + BigInt(recipient.amount), 0n) !== BigInt(record.fee)) return undefined
    entries.push({ id: record.id, payerKey, kind: record.kind, street: record.street, fee: record.fee, compensations })
  }
  return {
    handId: hand.id,
    status: hand.status === "cancelled" ? "cancelled" : hand.status === "settled" || state?.roll?.released ? "released" : "pending",
    players, entries,
  }
}
