import { addChipPayment, type PokerChipContribution, type PokerChipState } from "@synapse/shared/game-contracts"
import type { Prisma } from "@prisma/client"
import { seatOrder } from "./engine/seat-order"
import { resolveRules } from "./engine/rules"

type ChipAction = { seq: number; seatNo: number; amount: number; action: string; rollId?: string | null }
type ChipHand = { id: string; dealerSeat: number; rules: unknown }
type ChipSeat = { seatNo: number; startingStack: number }
type RollPayment = { id: string; seatNo: number; fee: number }
/** No cards, notes, identity or quote data crosses this public presentation boundary. */
export async function projectChipState(tx: Pick<Prisma.TransactionClient,"gamePokerAction">, hand: ChipHand, seats: ChipSeat[], rolls: RollPayment[], archivedActions?: ChipAction[]): Promise<PokerChipState> {
  const result: PokerChipState = {pot:[],roll:[],recent:[]}
  const append = (payment: PokerChipContribution) => {
    if (!payment.amount) return
    result[payment.fund] = addChipPayment(result[payment.fund],payment.amount)
    result.recent.push(payment)
    if (result.recent.length>32) result.recent.shift()
  }
  if (seats.length>=2) {
    const rules = resolveRules(hand.rules as Parameters<typeof resolveRules>[0])
    const order = seatOrder(seats.map(s=>s.seatNo),hand.dealerSeat)
    for (const [seatNo,blind] of [[order.smallBlind,rules.smallBlind],[order.bigBlind,rules.bigBlind]]) {
      const amount = Math.min(seats.find(s=>s.seatNo===seatNo)!.startingStack,blind)
      append({id:`${hand.id}:blind:${seatNo}`,seq:0,seatNo,amount,fund:"pot"})
    }
  }
  const paid = new Map(rolls.map(r=>[r.id,r]))
  const consume = (actions: ChipAction[]) => {
    for (const action of actions) {
      if (action.action==="roll_choose") continue
      const fund = action.action==="roll_start" ? "roll" : "pot"
      const amount = fund==="roll" ? paid.get(action.rollId ?? "")?.fee : action.amount
      if (amount===undefined) throw new Error("Poker chip projection missing Roll payment")
      append({id:`${hand.id}:${action.seq}:${fund}`,seq:action.seq,seatNo:action.seatNo,amount,fund})
    }
  }
  if (archivedActions) consume([...archivedActions].sort((a,b)=>a.seq-b.seq))
  else {
    let after = 0
    for (;;) {
      const page = await tx.gamePokerAction.findMany({where:{handId:hand.id,seq:{gt:after}},select:{seq:true,seatNo:true,action:true,amount:true,rollId:true},orderBy:{seq:"asc"},take:256})
      consume(page)
      if (page.length<256) break
      const last = page.at(-1)!.seq
      if (last<=after) throw new Error("Poker chip projection cursor did not advance")
      after = last
    }
  }
  return result
}
