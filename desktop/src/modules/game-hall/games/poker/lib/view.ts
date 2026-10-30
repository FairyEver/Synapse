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
export function remaining(ms: number | null): string {
  if (ms === null) return "—"
  const s = Math.max(0, Math.ceil(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`
}
export const amount = (value: number) => new Intl.NumberFormat("zh-CN").format(value)
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
