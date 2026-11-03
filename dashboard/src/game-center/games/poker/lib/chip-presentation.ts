import { addChipPayment, chipBreakdown, chipValue, POKER_CHIP_VALUES, subtractChipCounts, type PokerChipCount, type PokerChipState, type PokerTableView } from "@synapse/shared/game-contracts"
export type ChipFund = "pot" | "roll"
export type PresentedTransfer = { id: string; seatNo: number; fund: ChipFund; direction: "in" | "out"; amount: number; chips: PokerChipCount[]; kind: "bet" | "roll" | "card" | "steal" | "payout" | "refund" | "compensation"; started: boolean }
export type ChipPresentation = { key: string; context: string; table: PokerTableView; funds: Record<ChipFund,PokerChipCount[]>; banks: Record<number,number>; transfers: PresentedTransfer[]; phase: "idle" | "in" | "pot" | "roll"; settlementHand: string | null; ordered?: boolean }
export function mergeChips(...groups: readonly PokerChipCount[][]): PokerChipCount[] {
  return POKER_CHIP_VALUES.map(value=>({value,count:groups.reduce((sum,g)=>sum+(g.find(c=>c.value===value)?.count??0),0)})).filter(c=>c.count>0)
}
function seq(table: PokerTableView) { return table.actionSeq ?? table.recentActions.at(-1)?.seq ?? 0 }
function settled(table: PokerTableView) { return !!table.handId && table.settlement?.handId===table.handId }
function key(table: PokerTableView, context: string) { return `${context}:${table.roomCode}:${table.handId}` }
/** Old servers lack the per-payment inventory: show exact one-unit counts, never invent a large denomination. */
export function tableChipInventory(table: PokerTableView): PokerChipState {
  if (table.chipState) return table.chipState
  const ordinary = settled(table) ? table.settlement!.pots.reduce((sum,p)=>sum+p.amount,0) : table.pot
  const roll = table.seats.reduce((sum,s)=>sum+(s.rollPaid??0),0)
  let pot: PokerChipCount[]=[]
  for (const action of table.recentActions) if (action.amount>0) pot=addChipPayment(pot,action.amount)
  const known=chipValue(pot)
  pot=known>ordinary ? (ordinary>0?[{value:1,count:ordinary}]:[]) : mergeChips(pot,ordinary>known?[{value:1,count:ordinary-known}]:[])
  return {pot,roll:roll>0?[{value:1,count:roll}]:[],recent:table.recentActions.filter(a=>a.amount>0).map(a=>({id:`${table.handId}:${a.seq}:pot`,seq:a.seq,seatNo:a.seatNo,amount:a.amount,fund:"pot"}))}
}
export function seedChipPresentation(table: PokerTableView, context: string): ChipPresentation {
  const inventory = tableChipInventory(table)
  return {key:key(table,context),context,table,funds:settled(table)?{pot:[],roll:[]}:{pot:inventory.pot,roll:inventory.reserve ?? inventory.roll},banks:Object.fromEntries(table.seats.map(s=>[s.seatNo,s.stack])),transfers:[],phase:"idle",settlementHand:settled(table)?table.handId:null,...(inventory.reserve ? {ordered:true} : {})}
}
function advance(state: ChipPresentation): ChipPresentation {
  if (state.ordered) return { ...state, phase: !state.transfers.length ? "idle" : state.transfers[0].direction === "in" ? "in" : state.transfers[0].fund }
  const phase = state.transfers.some(t=>t.direction==="in") ? "in" : state.transfers.some(t=>t.fund==="pot") ? "pot" : state.transfers.length ? "roll" : "idle"
  if (phase===state.phase) return state
  const funds = {...state.funds}
  // Split into the exact recipients' denominations only at payout, never while accumulating wagers.
  if (phase==="pot" || phase==="roll") funds[phase]=mergeChips(...state.transfers.filter(t=>t.fund===phase).map(t=>t.chips))
  return {...state,phase,funds}
}
export function activeChipTransfers(state: ChipPresentation): PresentedTransfer[] {
  if (state.ordered) return state.transfers.slice(0, 1)
  return state.transfers.filter(t=>state.phase==="in" ? t.direction==="in" : t.direction==="out" && t.fund===state.phase)
}
export function updateChipPresentation(state: ChipPresentation, table: PokerTableView, context: string): ChipPresentation {
  if (state.context===context && table.roomCode===state.table.roomCode && table.handNo<state.table.handNo) return state
  if (key(table,context)!==state.key) return seedChipPresentation(table,context)
  if (seq(table)<seq(state.table) || (settled(state.table)&&!settled(table))) return state
  const visible=(seatNo:number)=>table.seats.some(s=>s.seatNo===seatNo&&s.inCurrentHand!==false)
  // Seat numbers can be reused before the next hand. Retire the old scene's jobs and
  // restore the authoritative snapshot instead of crediting a replacement occupant.
  if (state.transfers.some(t=>!visible(t.seatNo))) return seedChipPresentation(table,context)
  const inventory=tableChipInventory(table), transfers=[...state.transfers]
  if (inventory.reserve) return updateFundedPresentation(state, table, inventory, visible)
  if (!settled(state.table)) {
    const seen=new Set(transfers.map(t=>t.id))
    for (const payment of inventory.recent) if (payment.seq>seq(state.table) && !seen.has(payment.id) && visible(payment.seatNo)) {
      seen.add(payment.id)
      if (payment.amount > 0) transfers.push({...payment,fund:payment.fund === "reserve" ? "roll" : payment.fund,direction:"in",chips:chipBreakdown(payment.amount),kind:payment.kind ?? (payment.fund==="roll"?"roll":"bet"),started:false})
    }
  }
  const banks=Object.fromEntries(table.seats.map(s=>[s.seatNo,s.stack]))
  let settlementHand=state.settlementHand
  if (settled(table)&&settlementHand!==table.handId) {
    settlementHand=table.handId
    const payouts=table.settlement!.pots.flatMap((pot,index)=>Object.entries(pot.shares).filter(([seat,amount])=>amount>0&&visible(Number(seat))).map(([seat,amount])=>({id:`${table.handId}:pot:${index}:${seat}`,seatNo:Number(seat),amount,kind:pot.refund?"refund" as const:"payout" as const})))
    // A sole recipient receives the original chips (five 100s remain five 100s).
    const sole = new Set(payouts.map(t=>t.seatNo)).size===1 && payouts.reduce((sum,t)=>sum+t.amount,0)===chipValue(inventory.pot)
    const ordinary = sole ? [{...payouts[0],amount:chipValue(inventory.pot),chips:inventory.pot}] : payouts.map(t=>({...t,chips:chipBreakdown(t.amount)}))
    for (const payout of ordinary) transfers.push({...payout,fund:"pot",direction:"out",started:false})
    for (const seat of table.settlement!.seats) if ((seat.rollReceived??0)>0 && visible(seat.seatNo)) transfers.push({id:`${table.handId}:compensation:${seat.seatNo}`,seatNo:seat.seatNo,amount:seat.rollReceived!,chips:chipBreakdown(seat.rollReceived!),fund:"roll",direction:"out",kind:"compensation",started:false})
  }
  for (const transfer of transfers) if (transfer.direction==="out") banks[transfer.seatNo]=Math.max(0,(banks[transfer.seatNo]??0)-transfer.amount)
  const funds = settled(state.table) ? state.funds : {
    pot:subtractChipCounts(inventory.pot,mergeChips(...transfers.filter(t=>t.fund==="pot"&&t.direction==="in").map(t=>t.chips))),
    roll:subtractChipCounts(inventory.roll,mergeChips(...transfers.filter(t=>t.fund==="roll"&&t.direction==="in").map(t=>t.chips))),
  }
  return advance({...state,table,banks,transfers,funds,settlementHand})
}
export function startChipTransfer(state: ChipPresentation, id: string): ChipPresentation {
  const transfer=state.transfers.find(t=>t.id===id)
  if (!transfer || transfer.started) return state
  if (state.ordered) {
    const funds = transfer.direction === "out" ? { ...state.funds, [transfer.fund]: chipBreakdown(Math.max(0, chipValue(state.funds[transfer.fund]) - transfer.amount)) } : state.funds
    const banks = transfer.direction === "in" ? { ...state.banks, [transfer.seatNo]: Math.max(0, (state.banks[transfer.seatNo] ?? 0) - transfer.amount) } : state.banks
    return { ...state, funds, banks, transfers: state.transfers.map(t => t.id === id ? { ...t, started: true } : t) }
  }
  const transfers=state.transfers.map(t=>t.id===id?{...t,started:true}:t)
  const funds=transfer.direction==="out"?{...state.funds,[transfer.fund]:subtractChipCounts(state.funds[transfer.fund],transfer.chips)}:state.funds
  return {...state,transfers,funds}
}
export function finishChipTransfer(state: ChipPresentation, id: string): ChipPresentation {
  const transfer=state.transfers.find(t=>t.id===id)
  if (!transfer) return state
  if (state.ordered) {
    const funds = transfer.direction === "in" ? { ...state.funds, [transfer.fund]: chipBreakdown(chipValue(state.funds[transfer.fund]) + transfer.amount) } : !transfer.started ? { ...state.funds, [transfer.fund]: chipBreakdown(Math.max(0, chipValue(state.funds[transfer.fund]) - transfer.amount)) } : state.funds
    const banks = transfer.direction === "out" ? { ...state.banks, [transfer.seatNo]: (state.banks[transfer.seatNo] ?? 0) + transfer.amount } : !transfer.started ? { ...state.banks, [transfer.seatNo]: Math.max(0, (state.banks[transfer.seatNo] ?? 0) - transfer.amount) } : state.banks
    return advance({ ...state, funds, banks, transfers: state.transfers.filter(t => t.id !== id) })
  }
  const funds=transfer.direction==="in"?{...state.funds,[transfer.fund]:mergeChips(state.funds[transfer.fund],transfer.chips)}:state.funds
  const banks=transfer.direction==="out"?{...state.banks,[transfer.seatNo]:(state.banks[transfer.seatNo]??0)+transfer.amount}:state.banks
  return advance({...state,funds,banks,transfers:state.transfers.filter(t=>t.id!==id)})
}

/** "roll" remains the existing canvas anchor; v2 wire data and all amounts refer to the generic reserve. */
function updateFundedPresentation(state: ChipPresentation, table: PokerTableView, inventory: PokerChipState, visible: (seatNo: number) => boolean): ChipPresentation {
  const transfers = [...state.transfers], seen = new Set(transfers.map(t => t.id))
  for (const payment of inventory.recent) if (payment.amount > 0 && payment.seq > seq(state.table) && !seen.has(payment.id) && visible(payment.seatNo)) {
    seen.add(payment.id)
    transfers.push({ ...payment, fund: payment.fund === "pot" ? "pot" : "roll", direction: payment.direction ?? "in", kind: payment.kind ?? "bet", chips: chipBreakdown(payment.amount), started: false })
  }
  let settlementHand = state.settlementHand
  if (settled(table) && settlementHand !== table.handId) {
    settlementHand = table.handId
    const payouts: PresentedTransfer[] = table.settlement!.pots.flatMap((pot, index) => Object.entries(pot.shares).filter(([seat, value]) => value > 0 && visible(Number(seat))).map(([seat, value]) => ({ id: `${table.handId}:pot:${index}:${seat}`, seatNo: Number(seat), amount: value, fund: "pot", direction: "out", kind: pot.refund ? "refund" : "payout", chips: chipBreakdown(value), started: false })))
    const beforeReserve = transfers.findIndex(t => t.kind === "compensation")
    transfers.splice(beforeReserve < 0 ? transfers.length : beforeReserve, 0, ...payouts)
  }
  const banks = Object.fromEntries(table.seats.map(seat => [seat.seatNo, seat.stack]))
  const total = { pot: settled(table) ? 0 : chipValue(inventory.pot), roll: chipValue(inventory.reserve!) }
  for (const transfer of transfers) {
    if (transfer.direction === "out") {
      banks[transfer.seatNo] = (banks[transfer.seatNo] ?? 0) - transfer.amount
      if (!transfer.started) total[transfer.fund] += transfer.amount
    } else {
      if (!transfer.started) banks[transfer.seatNo] = (banks[transfer.seatNo] ?? 0) + transfer.amount
      total[transfer.fund] -= transfer.amount
    }
  }
  const funds = { pot: chipBreakdown(Math.max(0, total.pot)), roll: chipBreakdown(Math.max(0, total.roll)) }
  return advance({ ...state, table, banks, transfers, funds, settlementHand, ordered: true })
}
