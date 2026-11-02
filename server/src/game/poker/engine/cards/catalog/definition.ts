import type { CardDefinition, CardSelectionDefinition, DomainOperation } from "../types"

export const HOLE: CardSelectionDefinition = { key: "hole", label: "本人底牌", kind: "hole" }
export const PLAYER: CardSelectionDefinition = { key: "player", label: "目标玩家", kind: "player", target: "other_alive" }
export const HUMAN: CardSelectionDefinition = { ...PLAYER, target: "other_human" }
export const EXTRA: CardSelectionDefinition = { key: "ability", label: "另一张卡牌", kind: "ability", target: "own_other_ability" }
export const STATUS: CardSelectionDefinition = { key: "status", label: "持续效果", kind: "status", target: "public_effect" }
export const CLEANSE: CardSelectionDefinition = { ...STATUS, target: "own_negative" }
export const HIDDEN: CardSelectionDefinition = { key: "targetHole", label: "目标底牌", kind: "hole", target: "other_hidden_hole" }
export const COLOR: CardSelectionDefinition = { key: "color", label: "猜测颜色", kind: "color" }
export const step = (type: string, input: Record<string, unknown>): DomainOperation => ({ type, input })
export function card(id: string, name: string, copies: 1 | 2, description: string, steps: DomainOperation[], options: Partial<Omit<CardDefinition, "id" | "name" | "copies" | "description" | "artId" | "steps">> = {}): CardDefinition {
  return { id, name, description, artId: `v1/${id}`, ...(copies === 2 ? { copies } : {}), tags: [], selections: [], steps, ...options }
}
export function install(kind: string, remaining: number | null = null, data: Record<string, unknown> = {}, options: Record<string, unknown> = {}) {
  return step("ability.install", { kind, remaining, data, polarity: "positive", ...options, sourceInstanceId: "$instance" })
}
