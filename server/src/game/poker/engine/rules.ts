export type PokerVariant = "standard52" | "short32"
export interface PokerRules {
  variant: PokerVariant
  smallBlind: number
  bigBlind: number
  ruleOptions?: { roll?: boolean }
  rollPricingVersion?: string
}
export const ROLL_PRICING_VERSION = "roll-v1"
export const BLIND_LEVELS = [[1, 2], [2, 4], [5, 10], [10, 20]] as const
/** Missing historical snapshots retain the original 52-card, 1/2 rules. */
export function resolveRules(input: Omit<Partial<PokerRules>, "rollPricingVersion"> & { rollPricingVersion?: string | null } = {}): PokerRules {
  const variant = input.variant ?? "standard52"
  const smallBlind = input.smallBlind ?? 1, bigBlind = input.bigBlind ?? 2
  if (!["standard52", "short32"].includes(variant) ||
      !BLIND_LEVELS.some(([small, big]) => small === smallBlind && big === bigBlind))
    throw new Error("无效扑克规则")
  if (input.ruleOptions?.roll && input.rollPricingVersion !== ROLL_PRICING_VERSION)
    throw new Error("POKER_ROLL_VERSION_UNSUPPORTED")
  return { variant, smallBlind, bigBlind,
    ...(input.ruleOptions ? { ruleOptions: { ...input.ruleOptions } } : {}),
    ...(input.rollPricingVersion != null ? { rollPricingVersion: input.rollPricingVersion } : {}),
  }
}
