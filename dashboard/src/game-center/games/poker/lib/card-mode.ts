import { isModernPokerCardRules, type PokerRuleOptions, type PokerTableView } from "@synapse/shared/game-contracts"

export function isPokerCardMode(table: { ruleOptions?: PokerRuleOptions; rules?: { ruleOptions?: PokerRuleOptions; cardRulesVersion?: string }; cards?: { enabled: boolean } } | null | undefined): boolean {
  return !!(table?.cards?.enabled || table?.ruleOptions?.cards || table?.rules?.ruleOptions?.cards || table?.rules?.cardRulesVersion)
}

export function usesPokerHandDock(table: PokerTableView): boolean {
  return isModernPokerCardRules(table.cards?.version ?? table.rules?.cardRulesVersion)
}
export function hasPokerCardFlow(table: PokerTableView, perspective: "owner" | "public"): boolean {
  return usesPokerHandDock(table) && perspective === "owner" && table.mySeatNo !== null
}
