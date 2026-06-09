import path from "node:path"
import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import {
  resolveCcConversationWorkerPath,
  runCcConversationQueryWithRunner,
} from "../conversation-runner"
import type { CcConversationWorkerInput } from "../conversation-runner"

describe("CC conversation query runner", () => {
  it("uses the compiled worker next to the runner in development", () => {
    expect(resolveCcConversationWorkerPath("/repo/desktop/dist-electron/electron/services/usage-analysis")).toBe(
      path.join("/repo/desktop/dist-electron/electron/services/usage-analysis", "conversation-worker.js"),
    )
  })

  it("uses the unpacked worker script in a packaged asar app", () => {
    expect(resolveCcConversationWorkerPath("/Applications/Synapse.app/Contents/Resources/app.asar/dist-electron/electron/services/usage-analysis")).toBe(
      path.join("/Applications/Synapse.app/Contents/Resources/app.asar.unpacked/dist-electron/electron/services/usage-analysis", "conversation-worker.js"),
    )
  })

  it("keeps the conversation worker closure independent from main-process services", () => {
    const workerSources = [
      "../conversation-worker.ts",
      "../cc-conversation-service.ts",
      "../db-schema.ts",
      "../currency-migration.ts",
    ].map((relativePath) => readFileSync(path.join(__dirname, relativePath), "utf8"))

    for (const source of workerSources) {
      expect(source).not.toContain("../error-sanitize")
      expect(source).not.toContain("../log-store")
    }
  })

  it("delegates conversation list queries to an injected runner", async () => {
    const input = {
      dbPath: "/tmp/usage.db",
      operation: "list" as const,
      payload: { preset: "30d" as const, limit: 50 },
    }
    const result = { items: [], total: 0, partial: false }
    const calls: CcConversationWorkerInput[] = []

    await expect(runCcConversationQueryWithRunner(input, async (nextInput) => {
      calls.push(nextInput)
      return result
    })).resolves.toBe(result)
    expect(calls).toEqual([input])
  })

  it("delegates record detail queries to an injected runner", async () => {
    const input = {
      dbPath: "/tmp/usage.db",
      operation: "record-details" as const,
      payload: { sessionId: "session-1", limit: 200 },
    }
    const result = { sessionId: "session-1", rows: [], total: 0 }
    const calls: CcConversationWorkerInput[] = []

    await expect(runCcConversationQueryWithRunner(input, async (nextInput) => {
      calls.push(nextInput)
      return result
    })).resolves.toBe(result)
    expect(calls).toEqual([input])
  })
})
