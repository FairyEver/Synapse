import type { PokerHandLogEntry } from "@synapse/shared/game-contracts"
import { Check, ChevronsUp, CircleDollarSign, Coins, CornerDownRight, Plus, Shuffle, Sparkles, TrendingUp, X, type LucideIcon } from "lucide-react"
import { actionLabel } from "./view"

export const logRollStatus = { pending: "待选牌，费用已支付", completed: "已完成", replaced: "已重新抽取，费用不退", cancelled: "本手已取消" }
const blindLabels: Record<string, string> = { small_blind: "小盲", big_blind: "大盲" }
const actionIcons: Record<PokerHandLogEntry["action"], LucideIcon> = {
  small_blind: CircleDollarSign,
  big_blind: Coins,
  fold: X,
  check: Check,
  call: CornerDownRight,
  bet: Plus,
  raise: TrendingUp,
  allin: ChevronsUp,
  roll: Shuffle,
  card: Sparkles,
}
export function logActionIcon(entry: PokerHandLogEntry) {
  return entry.roll?.kind === "super" ? Sparkles : actionIcons[entry.action]
}
export function logEntryLabel(entry: PokerHandLogEntry) {
  return entry.card?.name ?? (entry.roll ? entry.roll.kind === "super" ? "超级 Roll" : "普通 Roll" : blindLabels[entry.action] ?? actionLabel[entry.action] ?? entry.action)
}
