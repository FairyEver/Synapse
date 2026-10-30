import type { PokerTableView } from "@synapse/shared/game-contracts"
export function projectTable(
  table: PokerTableView,
  perspective: "owner" | "public",
): PokerTableView {
  if (perspective === "owner") return table
  const publicTable = { ...table }
  delete publicTable.persona
  delete publicTable.hole
  delete publicTable.legalActions
  delete publicTable.toCall
  delete publicTable.minRaiseTo
  delete publicTable.maxRaiseTo
  return {
    ...publicTable,
    // Card visibility and account identity come from the authenticated server projection.
    seats: table.seats,
    recentActions: table.recentActions.map((entry) => {
      const action = { ...entry }
      delete action.note
      delete action.personaVersionId
      delete action.personaVersion
      return action
    }),
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
