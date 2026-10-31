import type { PokerActionView } from "@synapse/shared/game-contracts"
const streets = [
  { street: "preflop", label: "翻牌前", count: 0 },
  { street: "flop", label: "翻牌", count: 3 },
  { street: "turn", label: "转牌", count: 4 },
  { street: "river", label: "河牌", count: 5 },
]
export function recordStreets(board: readonly string[], actions: readonly PokerActionView[]) {
  return streets
    .filter((s) => s.count <= board.length)
    .map((s) => ({
      ...s,
      board: board.slice(0, s.count),
      actions: actions.filter((a) => a.street === s.street).sort((a, b) => a.seq - b.seq),
    }))
}
