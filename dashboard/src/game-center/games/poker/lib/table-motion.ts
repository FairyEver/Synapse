import type { PokerTableView } from "@synapse/shared/game-contracts"

export type ChipTransfer = { id: string; seatNo: number; amount: number; kind: "bet" | "collect" | "payout" | "refund"; delay: number }
export type TableMotion = { id: string; transfers: ChipTransfer[]; actions: PokerTableView["recentActions"]; turn: number | null; celebrate: number[] }
export const NO_MOTION: TableMotion = { id: "", transfers: [], actions: [], turn: null, celebrate: [] }
export function tableMotion(previous: PokerTableView, table: PokerTableView): TableMotion {
  if (!table.handId || table.handNo < previous.handNo) return NO_MOTION
  const sameHand = previous.handId === table.handId
  const seq = previous.actionSeq ?? previous.recentActions.at(-1)?.seq ?? 0
  const actions = table.recentActions.filter(a => !sameHand || a.seq > seq).sort((a,b) => a.seq-b.seq)
  const id = `${table.handId}:${table.actionSeq ?? table.recentActions.at(-1)?.seq ?? 0}:${table.street}:${table.actionOnSeat}`
  const transfers: ChipTransfer[] = []
  // A late snapshot may span multiple streets: show the latest street, never queue old hands.
  const street = sameHand ? previous.street : "preflop"
  const bets = new Map(sameHand ? previous.seats.map(s => [s.seatNo,s.streetBet]) : [])
  for (const a of actions) {
    if (a.amount <= 0) continue
    if (a.street === street) bets.set(a.seatNo,(bets.get(a.seatNo) ?? 0)+a.amount)
    if (a.street === table.street || a.street === street) transfers.push({id:`${table.handId}:${a.seq}:bet`,seatNo:a.seatNo,amount:a.amount,kind:"bet",delay:0})
  }
  if (sameHand && table.street !== previous.street) {
    for (const [seatNo,amount] of bets) if (amount > 0) transfers.push({id:`${id}:collect:${seatNo}`,seatNo,amount,kind:"collect",delay:transfers.length ? 240 : 0})
  }
  const settled = table.settlement && table.settlement.handId === table.handId && previous.settlement?.handId !== table.handId
  if (settled) table.settlement!.pots.forEach((pot,i) => {
    for (const [seat,amount] of Object.entries(pot.shares)) if (amount > 0) transfers.push({id:`${table.handId}:pot:${i}:${seat}`,seatNo:Number(seat),amount,kind:pot.refund ? "refund" : "payout",delay:520+i*80})
  })
  const winners = new Set(settled ? table.settlement!.pots.filter(p=>!p.refund).flatMap(p=>p.winners) : [])
  return { id, transfers, actions, turn: table.status === "running" && (previous.actionOnSeat !== table.actionOnSeat || !sameHand || previous.street !== table.street) ? table.actionOnSeat : null, celebrate: settled ? table.settlement!.seats.filter(s=>s.isMe && s.delta>0 && winners.has(s.seatNo)).map(s=>s.seatNo) : [] }
}
