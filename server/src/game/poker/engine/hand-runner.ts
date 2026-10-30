import { orderedDeck } from "./deck"
import { compareHands } from "./hand"
import { after, seatOrder } from "./seat-order"
import { splitPots, distribute } from "./pots"
import { applyBet, betToMatch, type Decision, type EngineSeat, type BettingState } from "./betting"
export { legalActions } from "./betting"
export interface HandState extends BettingState {
  street: "preflop" | "flop" | "turn" | "river" | "settled"
  dealerSeat: number
  board: string[]
  deck: string[]
  seats: EngineSeat[]
  showdownSeats: number[]
  payouts: Record<number, number>
  pots: ReturnType<typeof splitPots>
}
export function startHand(
  seats: readonly { seatNo: number; stack: number }[],
  dealerSeat: number,
  deck: readonly string[],
): HandState {
  if (
    deck.length !== 52 ||
    new Set(deck).size !== 52 ||
    deck.some((c) => !orderedDeck().includes(c)) ||
    seats.some((s) => !Number.isSafeInteger(s.stack) || s.stack <= 0)
  )
    throw new Error("无效初始牌局")
  const order = seatOrder(
    seats.map((s) => s.seatNo),
    dealerSeat,
  )
  const h: HandState = {
    street: "preflop",
    dealerSeat,
    board: [],
    deck: [...deck],
    currentBet: 2,
    minRaise: 2,
    actionOnSeat: null,
    showdownSeats: [],
    payouts: {},
    pots: [],
    seats: seats.map((p) => ({
      ...p,
      startingStack: p.stack,
      streetBet: 0,
      total: 0,
      folded: false,
      allIn: false,
      lastActedBet: null,
      hole: [],
    })),
  }
  for (let n = 0; n < 2; n++)
    for (const no of order.postflop)
      h.seats.find((s) => s.seatNo === no)!.hole.push(h.deck.shift()!)
  for (const [no, blind] of [
    [order.smallBlind, 1],
    [order.bigBlind, 2],
  ]) {
    const s = h.seats.find((s) => s.seatNo === no)!
    const amount = Math.min(s.stack, blind)
    s.stack -= amount
    s.total = amount
    s.streetBet = amount
    s.allIn = s.stack === 0
  }
  h.actionOnSeat = order.preflop.find((no) => !h.seats.find((s) => s.seatNo === no)!.allIn) ?? null
  progress(h, order.bigBlind)
  return h
}
export function act(state: HandState, seatNo: number, decision: Decision): HandState {
  const h = applyBet(state, seatNo, decision)
  progress(h, seatNo)
  return h
}
/** Timeout checks are recorded by the service, but the departed seat always forfeits the hand. */
export function removeFromHand(state: HandState, seatNo: number): HandState {
  const h = structuredClone(state)
  const p = h.seats.find((s) => s.seatNo === seatNo)
  if (!p) return h
  p.folded = true
  progress(h, seatNo)
  return h
}
function progress(h: HandState, last: number): void {
  const live = h.seats.filter((s) => !s.folded)
  if (live.length === 1) {
    settle(h, false)
    return
  }
  const active = live.filter((s) => !s.allIn)
  const pending = active.filter((s) => s.lastActedBet === null || s.streetBet < h.currentBet)
  if (
    (active.length > 1 && pending.length) ||
    (active.length === 1 && active[0].streetBet < betToMatch(h, active[0].seatNo))
  ) {
    h.actionOnSeat =
      after(
        h.seats.map((s) => s.seatNo),
        last,
      ).find((no) => pending.some((s) => s.seatNo === no)) ?? null
    return
  }
  if (h.street === "river") {
    settle(h, true)
    return
  }
  h.deck.shift() // burn
  const count = h.street === "preflop" ? 3 : 1
  h.board.push(...h.deck.splice(0, count))
  h.street = h.street === "preflop" ? "flop" : h.street === "flop" ? "turn" : "river"
  h.currentBet = 0
  h.minRaise = 2
  for (const s of h.seats) {
    s.streetBet = 0
    s.lastActedBet = null
  }
  if (active.length <= 1) {
    progress(h, h.dealerSeat)
    return
  }
  h.actionOnSeat =
    after(
      h.seats.map((s) => s.seatNo),
      h.dealerSeat,
    ).find((no) => active.some((s) => s.seatNo === no)) ?? null
}
function settle(h: HandState, showdown: boolean): void {
  const live = h.seats.filter((s) => !s.folded)
  h.showdownSeats = showdown ? live.map((s) => s.seatNo) : []
  h.pots = splitPots(h.seats)
  const order = after(
    h.seats.map((s) => s.seatNo),
    h.dealerSeat,
  )
  for (const pot of h.pots) {
    let winners = pot.eligible
    if (!pot.refund && live.length === 1) winners = [live[0].seatNo]
    else if (!pot.refund && winners.length > 1) {
      let best = winners[0]
      for (const no of winners.slice(1))
        if (
          compareHands(
            [...h.seats.find((s) => s.seatNo === no)!.hole, ...h.board],
            [...h.seats.find((s) => s.seatNo === best)!.hole, ...h.board],
          ) > 0
        )
          best = no
      winners = winners.filter(
        (no) =>
          compareHands(
            [...h.seats.find((s) => s.seatNo === no)!.hole, ...h.board],
            [...h.seats.find((s) => s.seatNo === best)!.hole, ...h.board],
          ) === 0,
      )
    }
    const shares = distribute(pot.amount, winners, order)
    for (const [no, amount] of Object.entries(shares)) {
      h.payouts[Number(no)] = (h.payouts[Number(no)] ?? 0) + amount
      h.seats.find((s) => s.seatNo === Number(no))!.stack += amount
    }
  }
  if (
    h.seats.reduce((sum, s) => sum + s.stack, 0) !==
    h.seats.reduce((sum, s) => sum + s.startingStack, 0)
  )
    throw new Error("筹码不守恒")
  h.street = "settled"
  h.actionOnSeat = null
}
