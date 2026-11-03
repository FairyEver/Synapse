import type { PokerHandLogEntry, PokerTableView } from "@synapse/shared/game-contracts"
import { actionLabel } from "./view"

export const bettingStreets = ["preflop", "flop", "turn", "river"] as const
export function matchLog(table: PokerTableView) {
  if (table.handLog?.handId === table.handId) return table.handLog
  return { complete: false, entries: table.recentActions.filter(a => Object.hasOwn(actionLabel, a.action) && bettingStreets.includes(a.street as typeof bettingStreets[number])).map(a => ({
    seq: a.seq, seatNo: a.seatNo, displayName: a.displayName ?? `座位 ${a.seatNo + 1}`, street: a.street,
    action: a.action, amount: a.amount, isAuto: a.isAuto, actionSource: a.actionSource,
  } as PokerHandLogEntry)).sort((a, b) => a.seq - b.seq) }
}
/** Public runout can reach streets without another betting action (all-in). */
export function reachedStreets(table: PokerTableView, entries = matchLog(table).entries) {
  const boardStreet = table.board.length >= 5 ? 3 : table.board.length >= 4 ? 2 : table.board.length >= 3 ? 1 : table.handId ? 0 : -1
  const last = Math.max(boardStreet, bettingStreets.indexOf(table.street as typeof bettingStreets[number]),
    ...entries.map(e => bettingStreets.indexOf(e.street)))
  return bettingStreets.filter((_, index) => index <= last)
}
export function matchOverview(table: PokerTableView) {
  const pot = table.potContributions?.handId === table.handId ? table.potContributions : undefined
  const ledger = table.rollLedger?.handId === table.handId ? table.rollLedger : undefined
  const rollKnown = !!ledger || table.roll?.enabled === false || table.ruleOptions?.roll === false
  const players = new Map([...(pot?.players ?? []), ...(ledger?.players ?? [])].map(p => [p.key, p]))
  const entries = ledger?.entries ?? [], log = matchLog(table)
  const cardFees = (seatNo?: number, street?: PokerHandLogEntry["street"]) => log.complete
    ? log.entries.reduce((total, entry) => total + (entry.action === "card" && (seatNo === undefined || entry.seatNo === seatNo) && (!street || entry.street === street) ? entry.amount : 0), 0)
    : undefined
  return {
    bet: pot?.total, cardFees: cardFees(), roll: rollKnown ? entries.reduce((sum, e) => sum + e.fee, 0) : undefined,
    count: rollKnown ? entries.length : undefined, rollStatus: ledger?.status,
    players: [...players.values()].sort((a, b) => a.seatNo - b.seatNo).map(p => {
      const paid = entries.filter(e => e.payerKey === p.key)
      return { ...p, bet: pot?.players.find(v => v.key === p.key)?.amount, cardFees: cardFees(p.seatNo),
        count: rollKnown ? paid.length : undefined, paid: rollKnown ? paid.reduce((sum, e) => sum + e.fee, 0) : undefined,
        normal: rollKnown ? paid.filter(e => e.kind === "normal").length : undefined,
        super: rollKnown ? paid.filter(e => e.kind === "super").length : undefined,
        received: rollKnown ? entries.flatMap(e => e.compensations).filter(s => s.key === p.key).reduce((sum, s) => sum + s.amount, 0) : undefined,
        rounds: reachedStreets(table, log.entries).map(street => ({ street,
          bet: log.complete ? log.entries.filter(e => e.street === street && e.seatNo === p.seatNo && e.action !== "roll" && e.action !== "card").reduce((sum, e) => sum + e.amount, 0) : undefined,
          cardFees: cardFees(p.seatNo, street),
          count: rollKnown ? paid.filter(e => e.street === street).length : undefined,
          paid: rollKnown ? paid.filter(e => e.street === street).reduce((sum, e) => sum + e.fee, 0) : undefined,
        })),
      }
    }),
  }
}
