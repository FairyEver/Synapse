import { mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { createTerminalStore } from "../store"
import type { TerminalGroup, TerminalOutputChunk, TerminalSession } from "../../shared/schema"

let tempDir = ""

function createValidGroup(overrides: Partial<TerminalGroup> = {}): TerminalGroup {
  return {
    id: "g1",
    name: "Default",
    createdAt: "2026-06-24T00:00:00.000Z",
    updatedAt: "2026-06-24T00:00:00.000Z",
    sortOrder: 0,
    ...overrides,
  }
}

function createValidSession(overrides: Partial<TerminalSession> = {}): TerminalSession {
  return {
    id: "s1",
    groupId: "g1",
    title: "zsh",
    cwd: tempDir,
    shell: "/bin/zsh",
    status: "running",
    createdAt: "2026-06-24T00:00:00.000Z",
    updatedAt: "2026-06-24T00:00:00.000Z",
    startedAt: "2026-06-24T00:00:00.000Z",
    cols: 80,
    rows: 24,
    lastOutputSeq: 1,
    ...overrides,
  }
}

function createValidOutput(overrides: Partial<TerminalOutputChunk> = {}): TerminalOutputChunk {
  return {
    sessionId: "s1",
    seq: 1,
    data: "hello",
    createdAt: "2026-06-24T00:00:01.000Z",
    source: "pty",
    ...overrides,
  }
}

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), "synapse-terminal-store-"))
})

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true })
})

describe("terminal store", () => {
  it("persists groups, sessions, and output chunks", async () => {
    const group = createValidGroup()
    const session = createValidSession()
    const output = createValidOutput()

    await createTerminalStore({ baseDir: tempDir }).saveState({
      groups: [group],
      sessions: [session],
      output: [output],
    })

    await expect(createTerminalStore({ baseDir: tempDir }).loadState()).resolves.toMatchObject({
      groups: [expect.objectContaining(group)],
      sessions: [expect.objectContaining(session)],
      output: [output],
    })
  })

  it("returns empty state when the state file does not exist", async () => {
    await expect(createTerminalStore({ baseDir: tempDir }).loadState()).resolves.toEqual({
      globalLaunch: { revision: 1, updatedAt: "1970-01-01T00:00:00.000Z" },
      toolbarActions: [],
      groups: [],
      workspaces: [],
      sessions: [],
      output: [],
      terminalDomainRevision: 0,
      operations: [],
      idempotency: [],
      checkpoints: [],
    })
  })

  it("loads legacy sessions with agentControl and drops the removed field", async () => {
    const group = createValidGroup()
    const session = createValidSession()
    await writeFile(path.join(tempDir, "terminal-state.json"), JSON.stringify({
      groups: [group],
      sessions: [{ ...session, agentControl: "enabled" }],
      output: [],
    }))

    await expect(createTerminalStore({ baseDir: tempDir }).loadState()).resolves.toMatchObject({
      groups: [expect.objectContaining(group)],
      sessions: [expect.objectContaining(session)],
      output: [],
    })
  })

  it("loads legacy groups without settings", async () => {
    await writeFile(path.join(tempDir, "terminal-state.json"), JSON.stringify({
      groups: [{
        id: "g1",
        name: "Legacy",
        createdAt: "2026-06-24T00:00:00.000Z",
        updatedAt: "2026-06-24T00:00:00.000Z",
        sortOrder: 0,
      }],
      sessions: [],
      output: [],
      terminalDomainRevision: 0,
      operations: [],
      idempotency: [],
      checkpoints: [],
    }))

    await expect(createTerminalStore({ baseDir: tempDir }).loadState()).resolves.toEqual({
      globalLaunch: { revision: 1, updatedAt: "1970-01-01T00:00:00.000Z" },
      toolbarActions: [],
      groups: [expect.objectContaining({ id: "g1", name: "Legacy" })],
      workspaces: [],
      sessions: [],
      output: [],
      terminalDomainRevision: 0,
      operations: [],
      idempotency: [],
      checkpoints: [],
    })
  })

  it("rejects invalid state on save", async () => {
    const store = createTerminalStore({ baseDir: tempDir })
    const validGroup = createValidGroup()
    const validSession = createValidSession()
    const validOutput = createValidOutput()

    await expect(store.saveState({
      groups: [{ ...validGroup, id: "" }],
      sessions: [validSession],
      output: [validOutput],
    })).rejects.toThrow()
    await expect(store.saveState({
      groups: [validGroup],
      sessions: [{ ...validSession, status: "paused" } as unknown as TerminalSession],
      output: [validOutput],
    })).rejects.toThrow()
    await expect(store.saveState({
      groups: [validGroup],
      sessions: [validSession],
      output: [{ ...validOutput, seq: 0 }],
    })).rejects.toThrow()
  })

  it("rejects malformed persisted state on load", async () => {
    await writeFile(path.join(tempDir, "terminal-state.json"), JSON.stringify({
      groups: [{ id: "", name: "Default", createdAt: "t1", updatedAt: "t1", sortOrder: 0 }],
      sessions: [],
      output: [],
    }), "utf8")

    await expect(createTerminalStore({ baseDir: tempDir }).loadState()).rejects.toThrow()
  })

  it("rejects duplicate group and session ids", async () => {
    const store = createTerminalStore({ baseDir: tempDir })
    const group = createValidGroup()
    const session = createValidSession()

    await expect(store.saveState({
      groups: [group, createValidGroup({ name: "Other" })],
      sessions: [session],
      output: [createValidOutput()],
    })).rejects.toThrow("Duplicate terminal group id")
    await expect(store.saveState({
      groups: [group],
      sessions: [session, createValidSession({ title: "Other" })],
      output: [createValidOutput()],
    })).rejects.toThrow("Duplicate terminal session id")
  })

  it("rejects sessions that reference missing groups", async () => {
    const store = createTerminalStore({ baseDir: tempDir })

    await expect(store.saveState({
      groups: [createValidGroup()],
      sessions: [createValidSession({ groupId: "missing" })],
      output: [],
    })).rejects.toThrow("Unknown terminal session group")

    await writeFile(path.join(tempDir, "terminal-state.json"), JSON.stringify({
      groups: [createValidGroup()],
      sessions: [createValidSession({ groupId: "missing" })],
      output: [],
    }), "utf8")
    await expect(store.loadState()).rejects.toThrow("Unknown terminal session group")
  })

  it("rejects output for missing sessions and duplicate output sequences", async () => {
    const store = createTerminalStore({ baseDir: tempDir })

    await expect(store.saveState({
      groups: [createValidGroup()],
      sessions: [createValidSession()],
      output: [createValidOutput({ sessionId: "missing" })],
    })).rejects.toThrow("Unknown terminal output session")
    await expect(store.saveState({
      groups: [createValidGroup()],
      sessions: [createValidSession()],
      output: [
        createValidOutput(),
        createValidOutput({ data: "again" }),
      ],
    })).rejects.toThrow("Duplicate terminal output seq")
  })
})
