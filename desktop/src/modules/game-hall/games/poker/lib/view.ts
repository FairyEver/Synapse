import type { PokerTableView } from "@synapse/shared/game-contracts"
export function projectTable(
  table: PokerTableView,
  perspective: "owner" | "public",
): PokerTableView {
  if (perspective === "owner") return table
  const {
    persona: _,
    hole: __,
    legalActions: ___,
    toCall: ____,
    minRaiseTo: _____,
    maxRaiseTo: ______,
    ...publicTable
  } = table
  return {
    ...publicTable,
    mySeatNo: null,
    seats: table.seats.map(({ hole, ...seat }) => seat),
    recentActions: table.recentActions.map(
      ({ note, personaVersionId, personaVersion, ...action }) => action,
    ),
  }
}
export { formatGameCountdown as remaining, formatGameAmount as amount } from "../../../lib/format"
export const streetLabel: Record<string, string> = {
  preflop: "翻牌前",
  flop: "翻牌",
  turn: "转牌",
  river: "河牌",
  showdown: "摊牌",
  settled: "已结算",
}
export const actionLabel: Record<string, string> = {
  fold: "弃牌",
  check: "过牌",
  call: "跟注",
  bet: "下注",
  raise: "加注",
  allin: "全下",
}
export function seatPosition(seatNo: number, maxSeats: number): number {
  return Math.round((seatNo * 10) / maxSeats) % 10
}
