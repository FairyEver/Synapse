import type { PokerHandLogEffect } from "@synapse/shared/game-contracts"
import type { LifecycleEvent } from "./engine/cards/types"

type Player = { seatNo: number; displayName: string }
const cardFace = /^[2-9TJQKA][shdc]$/
const nonnegative = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0

/** History only reads committed public facts, never operation inputs or private observations. */
export function projectHandLogEffect(
  event: LifecycleEvent, players: ReadonlyMap<number, Player>, cardNames: ReadonlyMap<string, string>, playedCardId?: string,
): PokerHandLogEffect | undefined {
  if (event.phase !== "after" || event.audience !== "public") return
  const { data } = event
  const target = nonnegative(data.targetSeatNo) ? players.get(data.targetSeatNo) : undefined
  const sourceCardName = event.cardId && event.cardId !== playedCardId ? cardNames.get(event.cardId) : undefined
  const source = sourceCardName ? { sourceCardName } : {}
  const scoped = target ? { ...source, target } : source
  switch (event.type) {
    case "poker.revealed": case "poker.publicMoved":
      if (target && Array.isArray(data.cards) && data.cards.length >= 1 && data.cards.length <= 2 &&
          data.cards.every(card => typeof card === "string" && cardFace.test(card))) return { ...source, kind: "revealed", target, cards: [...data.cards] }
      return
    case "poker.guessed":
      if (target && (data.color === "red" || data.color === "black") && typeof data.matched === "boolean")
        return { ...source, kind: "guessed", target, color: data.color, matched: data.matched }
      return
    case "ability.protected": return { ...scoped, kind: "protected" }
    case "ability.blocked": return { ...scoped, kind: "blocked" }
    case "ability.statusInstalled": return { ...scoped, kind: "installed" }
    case "ability.statusRemoved": {
      const removedCardName = typeof data.removedCardId === "string" ? cardNames.get(data.removedCardId) : undefined
      return { ...scoped, kind: "removed", ...(removedCardName ? { removedCardName } : {}) }
    }
    case "poker.sparked": return { ...source, kind: "sparked" }
    case "chips.stolen": case "chips.refunded": case "chips.distributed": case "chips.discarded": {
      const kinds = { "chips.stolen": "stolen", "chips.refunded": "refunded", "chips.distributed": "distributed", "chips.discarded": "discarded" } as const
      if (nonnegative(data.amount)) return { ...scoped, kind: kinds[event.type], amount: data.amount }
      return
    }
    case "poker.changed":
      if (target && (data.change === "replaced" || data.change === "exchanged" || data.change === "reordered") && (data.count === 1 || data.count === 2))
        return { ...source, kind: data.change, target, count: data.count }
      return
    case "poker.shuffled": {
      if (!Array.isArray(data.targetSeatNos)) return
      const targets = [...new Set(data.targetSeatNos)].flatMap(seatNo => players.get(seatNo) ?? [])
      if (targets.length >= 2) return { ...source, kind: "shuffled", targets }
      return
    }
    case "clock.extended":
      if (nonnegative(data.milliseconds)) return { ...scoped, kind: "clock", milliseconds: data.milliseconds }
  }
}

/** Older cards-v2 frames recorded successful own-card replacements without a separate public summary. */
export function projectLegacyOwnReplacement(
  event: LifecycleEvent, actor: Player | undefined, playedCardId?: string,
): PokerHandLogEffect | undefined {
  if (!actor || event.audience !== "internal" || event.phase !== "after" || event.status !== "completed" ||
      event.actorSeatNo !== actor.seatNo) return
  const { type, data } = event
  if (type === "poker.choose" && (playedCardId === "06" || playedCardId === "07"))
    return { kind: "replaced", target: actor, count: 1 }
  if (data.seatNo !== actor.seatNo) return
  if (type === "poker.replace" && playedCardId === "01" && data.mode === "draw") return { kind: "replaced", target: actor, count: 1 }
  if (type === "poker.reset" && playedCardId === "02") return { kind: "replaced", target: actor, count: 2 }
}
