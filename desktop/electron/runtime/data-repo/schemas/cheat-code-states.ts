import type { Migration, NamespaceSchema } from "../types"

export interface CheatCodeStatesEntryV1 extends Record<string, unknown> {
  schemaVersion: 1
  states: Record<string, boolean>
}

const noMigrations: readonly Migration[] = []

export const cheatCodeStatesSchema: NamespaceSchema<CheatCodeStatesEntryV1> = {
  name: "cheat-code.states",
  backend: "json",
  currentVersion: 1,
  migrations: noMigrations,
  validate: isCheatCodeStatesEntryV1,
  defaults: () => ({
    schemaVersion: 1,
    states: {},
  }),
}

function isCheatCodeStatesEntryV1(value: unknown): value is CheatCodeStatesEntryV1 {
  if (!isRecord(value)) {
    return false
  }

  if (value.schemaVersion !== 1 || !isRecord(value.states)) {
    return false
  }

  return Object.values(value.states).every((state) => typeof state === "boolean")
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
