import type { PokerHandLogEntry, PokerTableView } from "@synapse/shared/game-contracts"
import { logEntryLabel } from "./log-appearance"
import { bettingStreets, matchLog } from "./match-information"
import { streetLabel } from "./view"

export type PokerLogItem =
  | { id: string; action: PokerHandLogEntry }
  | { id: string; street: PokerHandLogEntry["street"]; cards: string[] }

export type PokerLogGroup = { id: string; label: string; items: PokerLogItem[] }

export function pokerLogItemLabel(item: PokerLogItem) {
  return "action" in item ? `${item.action.displayName}，${logEntryLabel(item.action)}` : streetLabel[item.street]
}

export function pokerLogGroups(table: PokerTableView) {
  const { complete, entries } = matchLog(table)
  const blinds: PokerLogGroup = { id: "blinds", label: "盲注", items: [] }
  const groups = bettingStreets.map(street => ({ id: street, label: streetLabel[street], items: [] as PokerLogItem[] }))
  const boardCount = [0, 0, 3, 4, 5]
  // Even a runout with no betting actions deals each set of public cards separately.
  groups.forEach((group, index) => {
    const end = boardCount[index + 1]
    if (index > 0 && table.handId && table.board.length >= end) {
      group.items.push({ id: group.id, street: group.id, cards: table.board.slice(boardCount[index], end) })
    }
  })
  for (const action of entries) {
    const group = action.action === "small_blind" || action.action === "big_blind"
      ? blinds : groups.find(group => group.id === action.street)
    group?.items.push({ id: `action:${action.seq}`, action })
  }
  return { complete, groups: [blinds, ...groups].filter(group => group.items.length > 0) }
}
