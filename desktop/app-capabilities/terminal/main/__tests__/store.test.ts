import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { createTerminalStore } from "../store"
import type { TerminalGroup, TerminalOutputChunk, TerminalSession } from "../../shared/schema"

let tempDir = ""

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), "synapse-terminal-store-"))
})

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true })
})

describe("terminal store", () => {
  it("persists groups, sessions, and output chunks", async () => {
    const group: TerminalGroup = {
      id: "g1",
      name: "Default",
      createdAt: "2026-06-24T00:00:00.000Z",
      updatedAt: "2026-06-24T00:00:00.000Z",
      sortOrder: 0,
    }
    const session: TerminalSession = {
      id: "s1",
      groupId: "g1",
      title: "zsh",
      cwd: tempDir,
      shell: "/bin/zsh",
      status: "running",
      createdAt: "2026-06-24T00:00:00.000Z",
      updatedAt: "2026-06-24T00:00:00.000Z",
      startedAt: "2026-06-24T00:00:00.000Z",
      agentControl: "disabled",
      cols: 80,
      rows: 24,
      lastOutputSeq: 1,
    }
    const output: TerminalOutputChunk = {
      sessionId: "s1",
      seq: 1,
      data: "hello",
      createdAt: "2026-06-24T00:00:01.000Z",
      source: "pty",
    }

    await createTerminalStore({ baseDir: tempDir }).saveState({
      groups: [group],
      sessions: [session],
      output: [output],
    })

    await expect(createTerminalStore({ baseDir: tempDir }).loadState()).resolves.toEqual({
      groups: [group],
      sessions: [session],
      output: [output],
    })
  })

  it("returns empty state when the state file does not exist", async () => {
    await expect(createTerminalStore({ baseDir: tempDir }).loadState()).resolves.toEqual({
      groups: [],
      sessions: [],
      output: [],
    })
  })
})
