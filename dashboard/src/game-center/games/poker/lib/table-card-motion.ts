import type { PokerTableView } from "@synapse/shared/game-contracts"

export type PokerCardChange = {
  kind: "replaced" | "exchanged" | "reordered" | "shuffled" | "effect"
  seats: number[]
  count: number
  slots?: Record<number, number[]>
}
export type PokerCardMotionBatch = {
  deals: string[]
  folds: number[]
  reveals: string[]
  winningCards: string[]
  casts: { id: string; name: string; artId: string; seatNo: number; blocked: boolean }[]
  changes: PokerCardChange[]
  draws: string[]
  payments: string[]
}

function participating(table: PokerTableView) {
  return table.seats.filter(seat => !seat.isHistorical && seat.inCurrentHand !== false)
}

export function planPokerCardMotion(previous: PokerTableView, current: PokerTableView): PokerCardMotionBatch | null {
  if (!current.handId || current.handNo < previous.handNo || current.status === "closed") return null
  const sameHand = current.handId === previous.handId
  const lastSeq = sameHand ? previous.actionSeq ?? 0 : 0
  if ((current.actionSeq ?? 0) < lastSeq || (!sameHand && current.street !== "preflop")) return null

  const seats = participating(current)
  const seatNumbers = new Set(seats.map(seat => seat.seatNo))
  const order = (seat: number) => (seat - (current.dealerSeat ?? -1) - 1 + current.maxSeats) % current.maxSeats
  const deals = sameHand ? [] : [0, 1].flatMap(index => [...seats].sort((a, b) => order(a.seatNo) - order(b.seatNo)).map(seat => `hole:${seat.seatNo}:${index}`))
  const existingBoard = sameHand ? previous.board.length : 0
  deals.push(...current.board.slice(existingBoard).map((_, index) => `board:${existingBoard + index}`))
  const folds = sameHand ? seats.filter(seat => seat.status === "folded" && previous.seats.some(before => before.seatNo === seat.seatNo && before.status !== "folded")).map(seat => seat.seatNo) : []

  const reveals: string[] = [], winningCards = new Set<string>()
  const settlement = sameHand && !previous.settlement && current.settlement?.handId === current.handId ? current.settlement : null
  if (settlement) {
    const winners = new Set(settlement.pots.filter(pot => !pot.refund).flatMap(pot => pot.winners))
    for (const seat of seats) {
      const previousSeat = previous.seats.find(before => before.seatNo === seat.seatNo)
      const result = settlement.seats.find(player => player.seatNo === seat.seatNo)
      const best = !result?.folded && winners.has(seat.seatNo) ? result?.bestFive : undefined
      seat.hole?.forEach((value, index) => {
        const slot = `hole:${seat.seatNo}:${index}`
        if (!previousSeat?.hole?.[index] && !previousSeat?.publicHole?.some(visible => visible.index === index)) reveals.push(slot)
        if (best?.includes(value)) winningCards.add(slot)
      })
      if (best) current.board.forEach((value, index) => {
        if (best.includes(value)) winningCards.add(`board:${index}`)
      })
    }
  }
  const batch: PokerCardMotionBatch = { deals, folds, reveals, winningCards: [...winningCards], casts: [], changes: [], draws: [], payments: [] }
  if (current.cards?.version === "cards-v2") {
    const entries = current.handLog?.handId === current.handId ? current.handLog.entries : []
    const entryBySeq = new Map(entries.map(entry => [entry.seq, entry]))
    const previousEntries = new Map((sameHand && previous.handLog?.handId === current.handId ? previous.handLog.entries : []).map(entry => [entry.seq, entry]))
    const plays = current.cards.used.filter(play => play.seq > lastSeq && seatNumbers.has(play.seatNo)).slice(-3)
    batch.casts = plays.map(play => ({
      id: play.id, name: play.name, seatNo: play.seatNo, blocked: play.status === "blocked",
      artId: entryBySeq.get(play.seq)?.card?.artId ?? previous.cards?.definitions?.[play.cardId]?.artId ?? play.cardId,
    }))
    batch.payments = (current.chipState?.recent ?? []).filter(payment => payment.amount > 0 && payment.kind === "card" &&
      payment.direction !== "out" && plays.some(play => play.seq === payment.seq && play.seatNo === payment.seatNo)).map(payment => payment.id)

    for (const entry of entries) {
      const before = previousEntries.get(entry.seq)
      if (entry.seq <= lastSeq && !before) continue
      const seen = new Set(before?.effects?.map(effect => JSON.stringify(effect)))
      for (const effect of entry.effects ?? []) {
        if (seen.has(JSON.stringify(effect))) continue
        if (effect.kind === "replaced" || effect.kind === "exchanged" || effect.kind === "reordered") {
          const targets = [...new Set(effect.kind === "exchanged" ? [entry.seatNo, effect.target.seatNo] : [effect.target.seatNo])]
          if (!targets.every(seat => seatNumbers.has(seat)) || effect.kind === "exchanged" && targets.length !== 2) continue
          const slots: Record<number, number[]> = {}
          if (sameHand && effect.count === 1) for (const seatNo of targets) {
            const oldHole = previous.seats.find(seat => seat.seatNo === seatNo)?.hole
            const newHole = current.seats.find(seat => seat.seatNo === seatNo)?.hole
            if (oldHole?.length !== 2 || newHole?.length !== 2) continue
            const changed = [0, 1].filter(index => oldHole[index] !== newHole[index])
            if (changed.length === effect.count) slots[seatNo] = changed
          }
          batch.changes.push({ kind: effect.kind, seats: targets, count: effect.count, ...(Object.keys(slots).length ? { slots } : {}) })
        } else if (effect.kind === "shuffled") {
          const targets = effect.targets.map(target => target.seatNo).filter(seat => seatNumbers.has(seat))
          if (targets.length > 1) batch.changes.push({ kind: effect.kind, seats: targets, count: 2 })
        } else if ("target" in effect && effect.target && seatNumbers.has(effect.target.seatNo)) {
          batch.changes.push({ kind: "effect", seats: [effect.target.seatNo], count: 0 })
        }
      }
    }
    batch.changes = batch.changes.slice(-6)

    const previousHand = previous.cards?.ownHand
    if (current.cards.ownHand && (!sameHand || previousHand)) {
      const before = new Set(sameHand ? previousHand?.map(card => card.instanceId) : [])
      batch.draws = current.cards.ownHand.filter(card => !before.has(card.instanceId)).map(card => card.instanceId)
    }
  }
  return Object.values(batch).some(items => items.length) ? batch : null
}
