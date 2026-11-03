import type { PokerCardChoiceSpec, PokerCardPendingView } from "@synapse/shared/game-contracts"

export type CardSelectionUI = "own-hole" | "player" | "opponent-hole" | "color" | "ability-material" | "status" | "poker-candidate" | "ability-candidate"
export type CardSelectionValues = Record<string, string | number>
export interface CardSelectionRequest {
  ui: CardSelectionUI
  key: string
  label: string
  options: PokerCardChoiceSpec["options"]
  pending?: PokerCardPendingView
}

const choiceUI: Record<PokerCardChoiceSpec["kind"], CardSelectionUI> = { hole: "own-hole", player: "player", ability: "ability-material", status: "status", color: "color" }
export function cardChoiceRequests(choices: PokerCardChoiceSpec[]): CardSelectionRequest[] {
  return choices.map(choice => ({ ...choice, ui: choice.key === "targetHole" ? "opponent-hole" : choiceUI[choice.kind] }))
}
export function cardCandidateRequest(pending: PokerCardPendingView): CardSelectionRequest {
  return { ui: pending.kind === "poker" ? "poker-candidate" : "ability-candidate", key: "candidate", label: "选择一张",
    options: pending.candidates.map((_, index) => ({ value: String(index), label: `候选 ${index + 1}` })), pending }
}

/** Keep only current server-authorized choices; no sole-option auto-selection. */
export function reconcileCardSelections(choices: PokerCardChoiceSpec[], values: CardSelectionValues): CardSelectionValues {
  const result: CardSelectionValues = {}
  for (const choice of choices) {
    if (choice.kind === "color" && choices.some(c => c.key === "targetHole") && result.targetHole === undefined) continue
    const value = values[choice.key]
    if (value !== undefined && choice.options.some(option => option.value === String(value))) result[choice.key] = value
  }
  return result
}
export function changeCardSelection(choices: PokerCardChoiceSpec[], values: CardSelectionValues, key: string, value: string): CardSelectionValues {
  const index = choices.findIndex(choice => choice.key === key && choice.options.some(option => option.value === value))
  if (index < 0) return reconcileCardSelections(choices, values)
  if (String(values[key]) === value) return reconcileCardSelections(choices, values)
  const before = Object.fromEntries(choices.slice(0, index).flatMap(choice => values[choice.key] === undefined ? [] : [[choice.key, values[choice.key]]]))
  return reconcileCardSelections(choices, { ...before, [key]: value })
}
