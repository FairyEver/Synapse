import { createHash } from "node:crypto"
import { HOLE_CARDS } from "./catalog/holes"
import { INFORMATION_CARDS } from "./catalog/information"
import { DRAW_CARDS } from "./catalog/draw"
import { RESERVE_CARDS } from "./catalog/reserve"
import { DEFENSE_CARDS } from "./catalog/defense"
import { TABLE_CARDS } from "./catalog/table"
import { CardRegistry } from "./registry"
import type { CardDefinition } from "./types"

function freeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) { Object.freeze(value); for (const child of Object.values(value)) freeze(child) }
  return value
}
export const CARD_CATALOG_V1: readonly CardDefinition[] = freeze([...HOLE_CARDS, ...INFORMATION_CARDS, ...DRAW_CARDS, ...RESERVE_CARDS, ...DEFENSE_CARDS, ...TABLE_CARDS])
export const CARD_CATALOG_V1_SNAPSHOT = Object.freeze({ version: "cards-v1", operationVersion: "card-operations-v1", digest: createHash("sha256").update(JSON.stringify(CARD_CATALOG_V1)).digest("hex"), recipe: CARD_CATALOG_V1.map(c => ({ id: c.id, copies: c.copies ?? 1 })) })
export function createCardRegistry(): CardRegistry {
  if (CARD_CATALOG_V1_SNAPSHOT.digest !== "1ea700d2ef4ca989ed87eb9c98c46bad87d07ffca64ff3c3b5e74ba9d556d57c") throw new Error("POKER_CARD_VERSION_UNSUPPORTED")
  return new CardRegistry(CARD_CATALOG_V1)
}
