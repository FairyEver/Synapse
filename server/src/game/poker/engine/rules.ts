import { isModernPokerCardRules, POKER_CARD_RULES_VERSIONS, POKER_DEFAULT_ROLL_COINS, POKER_MAX_ROLL_COINS, type PokerCardRulesVersion, type PokerRuleOptions } from "@synapse/shared/game-contracts"
export type PokerVariant = "standard52" | "short32"
export interface PokerRules {
  cardRulesVersion?: PokerCardRulesVersion
  chipRulesVersion?: "chips-v2"
  variant: PokerVariant
  smallBlind: number
  bigBlind: number
  ruleOptions?: PokerRuleOptions
  rollPricingVersion?: string
}
export const ROLL_PRICING_VERSION = "roll-v1"
export const BLIND_LEVELS = [[1, 2], [2, 4], [5, 10], [10, 20]] as const
/** Missing historical snapshots retain the original 52-card, 1/2 rules. */
export function resolveRules(input: Omit<Partial<PokerRules>, "rollPricingVersion"> & { rollPricingVersion?: string | null } = {}): PokerRules {
  const variant = input.variant ?? "standard52"
  const smallBlind = input.smallBlind ?? 1, bigBlind = input.bigBlind ?? 2
  const options = input.ruleOptions
  if (options !== undefined && (!options || typeof options !== "object" || Array.isArray(options) ||
      Object.keys(options).some(key => key !== "roll" && key !== "rollCoins" && key !== "cards") ||
      options.cards !== undefined && typeof options.cards !== "boolean" ||
      options.roll !== undefined && typeof options.roll !== "boolean" ||
      options.rollCoins !== undefined && (!Number.isInteger(options.rollCoins) || options.rollCoins < 1 || options.rollCoins > POKER_MAX_ROLL_COINS)))
    throw new Error("无效换牌规则")
  if (!["standard52", "short32"].includes(variant) ||
      !BLIND_LEVELS.some(([small, big]) => small === smallBlind && big === bigBlind))
    throw new Error("无效扑克规则")
  if (input.ruleOptions?.roll && input.rollPricingVersion !== ROLL_PRICING_VERSION)
    throw new Error("POKER_ROLL_VERSION_UNSUPPORTED")
  const knownCards = POKER_CARD_RULES_VERSIONS.some(version => version === input.cardRulesVersion)
  if (options?.cards && (!knownCards || input.chipRulesVersion !== "chips-v2") || input.cardRulesVersion != null && !knownCards
    || isModernPokerCardRules(input.cardRulesVersion) && (options?.cards !== true || options.roll === true || options.rollCoins !== undefined)
    || input.chipRulesVersion !== undefined && input.chipRulesVersion !== null && input.chipRulesVersion !== "chips-v2") throw new Error("POKER_CARD_VERSION_UNSUPPORTED")
  return { variant, smallBlind, bigBlind,
    ...(options ? { ruleOptions: { ...options, ...(options.roll ? { rollCoins: options.rollCoins ?? POKER_DEFAULT_ROLL_COINS } : {}) } } : {}),
    ...(input.rollPricingVersion != null ? { rollPricingVersion: input.rollPricingVersion } : {}),
    ...(input.cardRulesVersion != null ? { cardRulesVersion: input.cardRulesVersion } : {}),
    ...(input.chipRulesVersion != null ? { chipRulesVersion: input.chipRulesVersion } : {}),
  }
}
