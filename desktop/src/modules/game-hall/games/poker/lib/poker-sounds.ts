import type { PokerTableView } from "@synapse/shared/game-contracts"

export type PokerSound = "deal" | "card" | "fold" | "tap" | "coin1" | "coin2" | "collect" | "turn"
export type PokerSoundCue = { sound: PokerSound; delay: number; volume: number }

export function soundActionSeq(table: PokerTableView): number {
  return table.actionSeq ?? table.recentActions.at(-1)?.seq ?? 0
}

function coins(amount: number, bigBlind: number, delay = 0): PokerSoundCue[] {
  if (amount <= 0) return []
  const count = Math.min(6, 1 + Math.floor(Math.log2(Math.max(1, amount / bigBlind))))
  return Array.from({ length: count }, (_, i) => ({
    sound: i % 2 ? "coin2" : "coin1", delay: delay + i * 75, volume: 0.35,
  }))
}

/** Compare authoritative snapshots, never the event history or button clicks. */
export function pokerSoundCues(previous: PokerTableView, table: PokerTableView, perspective: "owner" | "public"): PokerSoundCue[] {
  if (!table.handId || table.status === "closed" || table.roomCode !== previous.roomCode || table.handNo < previous.handNo) return []
  const sameHand = previous.handId === table.handId
  if ((!sameHand && table.handNo !== previous.handNo + 1) || (sameHand && soundActionSeq(table) < soundActionSeq(previous))) return []
  const cues: PokerSoundCue[] = []
  const bigBlind = Math.max(1, table.bigBlind ?? 2)
  if (!sameHand) {
    // A late snapshot already past preflop must not replay the opening deal.
    if (table.street === "preflop") {
      const count = Math.min(6, table.seats.filter(s => s.status === "active" || s.status === "allin").length * 2)
      for (let i = 0; i < count; i++) cues.push({ sound: "deal", delay: (i + 1) * 55, volume: 0.28 })
      cues.push(...coins(table.seats.reduce((sum, s) => sum + s.streetBet, 0), bigBlind))
    }
  } else {
    // Coalesce rapid actions into one short money burst instead of a sound queue.
    const actions = table.recentActions.filter(a => a.seq > soundActionSeq(previous) && (a.street === previous.street || a.street === table.street)).slice(-3)
    cues.push(...coins(actions.reduce((sum, a) => sum + a.amount, 0), bigBlind))
    const last = actions.at(-1)
    if (last?.action === "fold") cues.push({ sound: "fold", delay: 0, volume: 0.25 })
    if (last?.action === "check") cues.push({ sound: "tap", delay: 0, volume: 0.3 })
    const newCards = Math.max(0, table.board.length - previous.board.length)
    for (let i = 0; i < newCards; i++) cues.push({ sound: "card", delay: (i + 1) * 55, volume: 0.28 })
    if (table.street !== previous.street && previous.seats.some(s => s.streetBet > 0)) {
      cues.push({ sound: "collect", delay: 240, volume: 0.25 })
    }
  }
  if (table.settlement?.handId === table.handId && previous.settlement?.handId !== table.handId) {
    const payout = table.settlement.pots.filter(p => !p.refund).reduce((sum, p) => sum + Object.values(p.shares).reduce((total, value) => total + value, 0), 0)
    cues.push(...coins(payout, bigBlind, 520))
  }
  if (perspective === "owner" && table.controller === "human" && table.mySeatNo !== null && table.status === "running" && table.actionOnSeat === table.mySeatNo
    && (!sameHand || previous.actionOnSeat !== table.actionOnSeat || previous.street !== table.street)) {
    cues.push({ sound: "turn", delay: 360, volume: 0.25 })
  }
  return cues
}
