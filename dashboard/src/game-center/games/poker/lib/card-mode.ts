import type { PokerRuleOptions } from "@synapse/shared/game-contracts"

export function isPokerCardMode(table: { ruleOptions?: PokerRuleOptions; rules?: { ruleOptions?: PokerRuleOptions; cardRulesVersion?: string }; cards?: { enabled: boolean } } | null | undefined): boolean {
  return !!(table?.cards?.enabled || table?.ruleOptions?.cards || table?.rules?.ruleOptions?.cards || table?.rules?.cardRulesVersion)
}
