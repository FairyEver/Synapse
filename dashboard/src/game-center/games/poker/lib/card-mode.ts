import type { PokerRuleOptions, PokerTableView } from "@synapse/shared/game-contracts"

export function isPokerCardMode(table: { ruleOptions?: PokerRuleOptions; rules?: { ruleOptions?: PokerRuleOptions; cardRulesVersion?: string }; cards?: { enabled: boolean } } | null | undefined): boolean {
  return !!(table?.cards?.enabled || table?.ruleOptions?.cards || table?.rules?.ruleOptions?.cards || table?.rules?.cardRulesVersion)
}

export function usesPokerHandDock(table: PokerTableView): boolean {
  return (table.cards?.version ?? table.rules?.cardRulesVersion) === "cards-v2"
}
export function hasPokerHandDock(table: PokerTableView, perspective: "owner" | "public"): boolean {
  return usesPokerHandDock(table) && perspective === "owner" && table.mySeatNo !== null
    && (!!table.cards?.ownHand || !!table.hole?.length)
}
