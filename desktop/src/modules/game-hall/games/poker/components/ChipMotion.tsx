import type { CSSProperties } from "react"
import type { PokerTableEvent, PokerTableView } from "@synapse/shared/game-contracts"
import { amount, seatPosition } from "../lib/view"
import { eventKey } from "../lib/table-layout"
const positions = [[50,85],[27,81],[13,65],[13,35],[27,18],[50,14],[73,18],[87,35],[87,65],[73,81]]
function vector(seatNo: number, maxSeats: number, origin: number) {
  const [x,y] = positions[seatPosition(seatNo,maxSeats,origin)]
  return {x:(x-50)*12.04,y:(y-50)*6.24}
}
function path(from: {x:number;y:number}, to: {x:number;y:number}): CSSProperties {
  return {"--chip-from-x":`${from.x}px`,"--chip-from-y":`${from.y}px`,"--chip-to-x":`${to.x}px`,"--chip-to-y":`${to.y}px`} as CSSProperties
}
export function ChipMotion({events,table,history}: {events:PokerTableEvent[];table:PokerTableView;history:PokerTableEvent[]}) {
  return <div className="poker-chip-motion" aria-hidden="true">{events.flatMap(event => {
    if(event.kind === "settlement") return event.settlement?.pots.flatMap((pot,i) => Object.entries(pot.shares).map(([seat,share]) => <span key={`${eventKey(event)}:${i}:${seat}`} className="poker-chip-transfer" data-motion={pot.refund ? "refund" : "payout"} style={path({x:0,y:0},vector(Number(seat),table.maxSeats, table.mySeatNo ?? 0))}>{amount(share)}</span>)) ?? []
    if (!event.action || event.action.amount <= 0) return []
    const from = vector(event.action.seatNo, table.maxSeats, table.mySeatNo ?? 0)
    const streetActions = history.filter(e => e.handId === event.handId && e.action?.street === event.action!.street)
    const closing = table.street !== event.action.street && !streetActions.some(e => e.seq > event.seq)
    const bet = <span key={eventKey(event)} className="poker-chip-transfer" data-motion="bet" style={path(from, {x:from.x*0.62,y:from.y*0.62})}>{amount(event.action.amount)}</span>
    if (!closing) return bet
    const bets = new Map<number, number>()
    for (const entry of streetActions) if (entry.action && entry.action.amount > 0) bets.set(entry.action.seatNo, (bets.get(entry.action.seatNo) ?? 0) + entry.action.amount)
    return [bet, ...[...bets].map(([seat, chips]) => {
      const position = vector(seat, table.maxSeats, table.mySeatNo ?? 0)
      return <span key={`${eventKey(event)}:collect:${seat}`} className="poker-chip-transfer" data-motion="collect" style={path({x:position.x*0.62,y:position.y*0.62}, {x:0,y:0})}>{amount(chips)}</span>
    })]
  })}</div>
}
