export type PokerVariant = "standard52" | "short32"
export interface PokerRules {
  variant: PokerVariant
  smallBlind: number
  bigBlind: number
}
export const BLIND_LEVELS = [[1, 2], [2, 4], [5, 10], [10, 20]] as const
/** Missing historical snapshots retain the original 52-card, 1/2 rules. */
export function resolveRules(input: Partial<PokerRules> = {}): PokerRules {
  const variant = input.variant ?? "standard52"
  const smallBlind = input.smallBlind ?? 1, bigBlind = input.bigBlind ?? 2
  if (!["standard52", "short32"].includes(variant) ||
      !BLIND_LEVELS.some(([small, big]) => small === smallBlind && big === bigBlind))
    throw new Error("无效扑克规则")
  return { variant, smallBlind, bigBlind }
}
