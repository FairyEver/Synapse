export type ActionKind = "fold" | "check" | "call" | "bet" | "raise" | "allin"
export interface Decision {
  action: ActionKind
  to?: number
}
export interface EngineSeat {
  seatNo: number
  stack: number
  startingStack: number
  streetBet: number
  total: number
  folded: boolean
  allIn: boolean
  lastActedBet: number | null
  hole: string[]
}
export interface BettingState {
  seats: EngineSeat[]
  currentBet: number
  minRaise: number
  actionOnSeat: number | null
  street: string
}
export function legalActions(h: BettingState, seatNo: number) {
  const p = h.seats.find((s) => s.seatNo === seatNo)
  if (!p || p.folded || p.allIn || h.actionOnSeat !== seatNo || h.street === "settled")
    return { actions: [] as ActionKind[], toCall: 0, minRaiseTo: 0, maxRaiseTo: 0 }
  const toCall = Math.max(0, h.currentBet - p.streetBet),
    maxRaiseTo = p.streetBet + p.stack
  const canRaise = p.lastActedBet === null || h.currentBet - p.lastActedBet >= h.minRaise
  const minRaiseTo = h.currentBet + h.minRaise
  const actions: ActionKind[] = ["fold", toCall ? "call" : "check"]
  if (canRaise && maxRaiseTo >= minRaiseTo) actions.push(h.currentBet ? "raise" : "bet")
  if (maxRaiseTo <= h.currentBet || canRaise) actions.push("allin")
  return { actions, toCall, minRaiseTo, maxRaiseTo }
}
export function applyBet<T extends BettingState>(state: T, seatNo: number, decision: Decision): T {
  const h = structuredClone(state)
  const legal = legalActions(h, seatNo)
  if (!legal.actions.includes(decision.action)) throw new Error("POKER_ILLEGAL_ACTION")
  const p = h.seats.find((s) => s.seatNo === seatNo)!
  if (decision.action === "fold") p.folded = true
  else if (decision.action !== "check") {
    let to =
      decision.action === "allin"
        ? legal.maxRaiseTo
        : decision.action === "call"
          ? Math.min(h.currentBet, legal.maxRaiseTo)
          : decision.to
    if (
      to === undefined ||
      !Number.isSafeInteger(to) ||
      to < p.streetBet ||
      to > legal.maxRaiseTo ||
      (["raise", "bet"].includes(decision.action) && to < legal.minRaiseTo)
    )
      throw new Error("POKER_ILLEGAL_ACTION")
    const amount = to - p.streetBet
    p.stack -= amount
    p.total += amount
    p.streetBet = to
    p.allIn = p.stack === 0
    if (to > h.currentBet) {
      const increment = to - h.currentBet
      if (increment >= h.minRaise) h.minRaise = increment
      h.currentBet = to
    }
  }
  p.lastActedBet = h.currentBet
  return h
}
