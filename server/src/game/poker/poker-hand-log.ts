import type { PokerHandLog, PokerHandLogEntry } from "@synapse/shared/game-contracts"
import { resolveRules } from "./engine/rules"
import { seatOrder } from "./engine/seat-order"

interface Input {
  roomId: string
  hand: { id: string; status: string; dealerSeat: number; rules: unknown; actionSeq: number }
  participants: readonly { handId: string; seatNo: number; userId: string; displayName: string; startingStack: number }[]
  actions: readonly { handId: string; roomId: string; seq: number; seatNo: number; userId: string; street: string; action: string; amount: number; rollId?: string | null; isAuto: boolean; actionSource?: string | null }[]
  rolls: readonly { id: string; seatNo: number; kind: string; fee: number; count: number; selectedIndex: number | null }[]
  pendingRollId: string | null
}
const streets = ["preflop", "flop", "turn", "river"]
const actions = ["fold", "check", "call", "bet", "raise", "allin"]
const sources = ["mcp", "human", "timeout", "rules_bot"]
const money = (n: number) => Number.isSafeInteger(n) && n >= 0

/** Public whitelist: never spread stored actions or Roll data across this boundary. */
export function projectHandLog(input: Input): PokerHandLog | undefined {
  const { hand, participants } = input
  if (participants.length < 2 || participants.length > 10 || participants.some(p => p.handId !== hand.id || !money(p.startingStack)) ||
      new Set(participants.map(p => p.seatNo)).size !== participants.length) return undefined
  const ordered = [...input.actions].sort((a, b) => a.seq - b.seq)
  const complete = ordered.length === hand.actionSeq && ordered.every((a, i) => a.seq === i + 1)
  const entries: PokerHandLogEntry[] = []
  if (complete) {
    try {
      const rules = resolveRules((hand.rules ?? {}) as Parameters<typeof resolveRules>[0])
      const order = seatOrder(participants.map(p => p.seatNo), hand.dealerSeat)
      for (const [i, [seatNo, blind]] of [[order.smallBlind, rules.smallBlind], [order.bigBlind, rules.bigBlind]].entries()) {
        const p = participants.find(p => p.seatNo === seatNo)!
        entries.push({ seq: i - 1, seatNo, displayName: p.displayName, street: "preflop", action: i === 0 ? "small_blind" : "big_blind", amount: Math.min(p.startingStack, blind), isAuto: false })
      }
    } catch {
      // Corrupt historical rules cannot produce a trustworthy blind record.
      return undefined
    }
  }
  for (const [index, a] of ordered.entries()) {
    const p = participants.find(p => p.seatNo === a.seatNo && p.userId === a.userId)
    if (!p || a.handId !== hand.id || a.roomId !== input.roomId || !Number.isSafeInteger(a.seq) || a.seq < 1 || a.seq > hand.actionSeq ||
        (index > 0 && ordered[index - 1].seq === a.seq) || !streets.includes(a.street) || !money(a.amount)) return undefined
    if (a.action === "roll_choose") continue
    const base = { seq: a.seq, seatNo: p.seatNo, displayName: p.displayName, street: a.street as PokerHandLogEntry["street"], isAuto: a.isAuto,
      ...(a.actionSource && sources.includes(a.actionSource) ? { actionSource: a.actionSource as PokerHandLogEntry["actionSource"] } : {}) }
    if (a.action === "roll_start") {
      const r = input.rolls.find(r => r.id === a.rollId && r.seatNo === a.seatNo)
      if (!r || !money(r.fee) || r.fee === 0 || !Number.isSafeInteger(r.count) || r.count < 1 || !["normal", "super"].includes(r.kind)) return undefined
      entries.push({ ...base, action: "roll", amount: r.fee, roll: { kind: r.kind as "normal" | "super", count: r.count,
        status: hand.status === "cancelled" ? "cancelled" : input.pendingRollId === r.id ? "pending" : r.selectedIndex !== null ? "completed" : "replaced" } })
    } else {
      if (!actions.includes(a.action)) return undefined
      entries.push({ ...base, action: a.action as PokerHandLogEntry["action"], amount: a.amount })
    }
  }
  return { handId: hand.id, complete, entries }
}
