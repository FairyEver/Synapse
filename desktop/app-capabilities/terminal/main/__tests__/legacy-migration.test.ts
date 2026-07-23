import { createHash, randomUUID } from "node:crypto"
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { describe, expect, it } from "vitest"

import { migrateLegacyTerminalState } from "../legacy-migration"
import type { TerminalStore, TerminalStoreState } from "../store"

describe("legacy Terminal migration", () => {
  it("maps only proven legacy facts and permanently marks a successful migration", async () => {
    const baseDir = mkdtempSync(path.join(os.tmpdir(), "synapse-terminal-legacy-"))
    const groupId = randomUUID()
    const runningId = randomUUID()
    const killedId = randomUUID()
    const source = Buffer.from(JSON.stringify({
      groups: [{ id: groupId, name: "Main", createdAt: timestamp(), updatedAt: timestamp(), sortOrder: 0, settings: { startupCommand: "pnpm dev" } }],
      sessions: [
        legacySession(runningId, groupId, "running"),
        { ...legacySession(killedId, groupId, "killed"), signal: 9 },
      ],
      output: [{ sessionId: killedId, seq: 2, data: "legacy", createdAt: timestamp(), source: "pty" }],
    }))
    writeFileSync(path.join(baseDir, "terminal-state.json"), source)
    const target = memoryTarget()
    expect(await migrateLegacyTerminalState({ baseDir, target, targetIsEmpty: async () => true })).toBe("migrated")
    expect(target.state.sessions.find((item) => item.id === runningId)).toMatchObject({
      status: "lost",
      endCause: "legacy_runtime_unrecoverable_after_restart",
      inputRevision: 0,
      inputHistoryBeforeBaselineUnknown: true,
      creationSource: "legacy_unknown",
      launchRevisionApplied: null,
    })
    expect(target.state.sessions.find((item) => item.id === killedId)).toMatchObject({
      status: "ended",
      endCause: "legacy_killed_unclassified",
      signal: 9,
      endTimeUnknown: true,
    })
    expect(target.state.groups[0]?.settings?.commands?.[0]).toMatchObject({ command: "pnpm dev" })
    const digest = createHash("sha256").update(source).digest("hex")
    expect(existsSync(path.join(baseDir, `terminal-state.${digest}.migration-v2.bak`))).toBe(true)
    expect(readFileSync(path.join(baseDir, "terminal-state.json"))).toEqual(source)
    expect(await migrateLegacyTerminalState({ baseDir, target, targetIsEmpty: async () => true })).toBe("already_migrated")
  })
})

function legacySession(id: string, groupId: string, status: "running" | "killed") {
  return {
    id, groupId, title: "Shell", cwd: "/tmp", shell: "/bin/sh", status,
    createdAt: timestamp(), updatedAt: timestamp(), startedAt: timestamp(), cols: 80, rows: 24, lastOutputSeq: status === "killed" ? 2 : 0,
  }
}

function memoryTarget(): TerminalStore & { state: TerminalStoreState } {
  const holder = {
    state: { groups: [], sessions: [], output: [], terminalDomainRevision: 0, operations: [], idempotency: [], checkpoints: [] } as TerminalStoreState,
    async loadState() { return structuredClone(holder.state) },
    async saveState(state: Parameters<TerminalStore["saveState"]>[0]) {
      holder.state = { operations: [], idempotency: [], ...structuredClone(state) } as TerminalStoreState
    },
  }
  return holder
}

function timestamp(): string {
  return "2026-07-22T00:00:00.000Z"
}
