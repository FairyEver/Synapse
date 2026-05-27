import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const electronMock = vi.hoisted(() => ({
  app: {
    getAppPath: vi.fn(() => "/Applications/Synapse.app"),
    getPath: vi.fn(),
  },
}))

vi.mock("electron", () => electronMock)

let tempDir = ""
let logStore: typeof import("../log-store").logStore

describe("logStore", () => {
  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "synapse-logs-"))
    electronMock.app.getPath.mockReturnValue(tempDir)
    vi.resetModules()
    const module = await import("../log-store")
    logStore = module.logStore
  })

  afterEach(async () => {
    await logStore.dispose()
    await rm(tempDir, { recursive: true, force: true })
    electronMock.app.getPath.mockReset()
  })

  it("redacts session keys from structured log details", () => {
    const entry = logStore.write({
      source: "main",
      level: "info",
      category: "agent-runtime",
      message: "scheduled agent completed",
      details: {
        sessionKey: "scheduled:project-1:secret",
        nested: {
          session_key: "external:group:secret",
          sourceSessionKey: "source:secret",
          note: "sessionKey=inline-secret token=inline-token",
        },
      },
    })

    expect(entry.details).toContain("[redacted]")
    expect(entry.details).not.toContain("scheduled:project-1:secret")
    expect(entry.details).not.toContain("external:group:secret")
    expect(entry.details).not.toContain("source:secret")
    expect(entry.details).not.toContain("inline-secret")
    expect(entry.details).not.toContain("inline-token")
  })
})
