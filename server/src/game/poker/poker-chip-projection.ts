import { addChipPayment, chipBreakdown, isModernPokerCardRules, type PokerChipContribution, type PokerChipState } from "@synapse/shared/game-contracts"
import type { ReserveState } from "./engine/chips/types"
import type { ResolutionFrame } from "./engine/cards/types"
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
  const rules = resolveRules((hand.rules ?? {}) as Parameters<typeof resolveRules>[0])
  const append = (payment: PokerChipContribution & { fund: "pot" | "roll" }) => {
    if (!payment.amount) return
    result[payment.fund] = addChipPayment(result[payment.fund],payment.amount)
    result.recent.push(payment)
    if (result.recent.length>32) result.recent.shift()
  }
  if (seats.length>=2) {
    const order = seatOrder(seats.map(s=>s.seatNo),hand.dealerSeat)
    for (const [seatNo,blind] of [[order.smallBlind,rules.smallBlind],[order.bigBlind,rules.bigBlind]]) {
      const amount = Math.min(seats.find(s=>s.seatNo===seatNo)!.startingStack,blind)
      append({id:`${hand.id}:blind:${seatNo}`,seq:0,seatNo,amount,fund:"pot"})
    }
  }
  const paid = new Map(rolls.map(r=>[r.id,r]))
  const consume = (actions: ChipAction[]) => {
    for (const action of actions) {
      if (action.action === "card_choose" || action.action === "card_play" && !isModernPokerCardRules(rules.cardRulesVersion)) continue
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

/** Complete financial facts from bounded whole roots; private facts never enter the artwork payload. */
export function projectFundedChipState(base: PokerChipState, reserve: ReserveState | undefined, participants: readonly { admissionId: string | null; seatNo: number }[], frames: readonly ResolutionFrame[]): PokerChipState {
  const recent: PokerChipContribution[] = [], seats = new Map(participants.filter(p => p.admissionId).map(p => [p.admissionId!, p.seatNo]))
  const append = (root: ResolutionFrame, index: number | string, seatNo: number | null | undefined, amount: unknown, fund: "pot" | "reserve", direction: "in" | "out", kind: PokerChipContribution["kind"]) => {
    if (seatNo == null || !Number.isInteger(seatNo) || seatNo < 0 || !Number.isSafeInteger(amount) || Number(amount) <= 0) return
    recent.push({ id: `${root.id}:${index}`, seq: root.seq, seatNo, amount: Number(amount), fund, direction, kind })
  }
  for (const root of [...frames].sort((a, b) => a.seq - b.seq)) for (const event of root.events) {
    if (event.audience !== "public") continue
    const target = typeof event.data.targetSeatNo === "number" ? event.data.targetSeatNo : event.actorSeatNo
    if (event.type === "bet.completed") append(root, event.index, target, event.data.amount, "pot", "in", "bet")
    if (event.type === "chips.paid" && event.data.destination === "pot") append(root, event.index, target, event.data.amount, "pot", "in", "card")
    if (event.type === "chips.deposited") append(root, event.index, target, event.data.amount, "reserve", "in", event.cardId ? "card" : "roll")
    if (event.type === "chips.stolen" || event.type === "chips.refunded") append(root, event.index, event.actorSeatNo, event.data.amount, "reserve", "out", event.type === "chips.stolen" ? "steal" : "refund")
    if (event.type === "chips.distributed") {
      const credits = new Map<number, number>()
      for (const move of reserve?.movements.filter(m => m.rootActionId === root.rootActionId && m.kind === "finalize") ?? []) {
        const seatNo = move.toAdmissionId ? seats.get(move.toAdmissionId) : undefined
        if (seatNo !== undefined) credits.set(seatNo, (credits.get(seatNo) ?? 0) + move.amount)
      }
      for (const [seatNo, amount] of credits) append(root, `${event.index}:${seatNo}`, seatNo, amount, "reserve", "out", "compensation")
    }
  }
  return {
    pot: base.pot, roll: [], recent,
    ...(reserve ? { reserve: chipBreakdown(reserve.lots.reduce((sum, lot) => sum + lot.remainingAmount, 0)) } : {}),
  }
}
