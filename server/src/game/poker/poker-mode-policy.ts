import type { CardViewPolicy } from "./poker-card-projection"
import { reject } from "./poker-error"

type ModeRoom = { ruleOptions?: unknown; cardRulesVersion?: string | null }
export function isCardRoom(room: ModeRoom): boolean { return !!room.cardRulesVersion || !!(room.ruleOptions as { cards?: boolean } | null)?.cards }
export function assertPokerModeAccess(room: ModeRoom, caller: "human" | "mcp" | "rules_bot" | "timeout" | "system", operation: string): void {
  if (!isCardRoom(room)) return
  const writes = ["join", "ready", "start", "act", "roll.start", "roll.choose", "card.play", "card.choose", "claim", "sit", "checkpoint"]
  if (operation === "control.request_ai" || operation === "claim" || caller === "mcp" && writes.includes(operation)
    || caller === "rules_bot" && !["act", "roll.start", "roll.choose"].includes(operation)) reject("POKER_CARD_AI_DISABLED", "卡牌房当前仅支持真人操作。")
}
export function cardReadPolicy(room: ModeRoom, caller: "human" | "mcp", requested: CardViewPolicy): CardViewPolicy {
  return isCardRoom(room) && caller !== "human" ? { ...requested, audience: "decision", perspective: "public", self: undefined } : requested
}
