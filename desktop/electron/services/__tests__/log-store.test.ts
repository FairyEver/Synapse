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

  it("redacts install session IDs from structured log details", () => {
    const entry = logStore.write({
      source: "main",
      level: "warn",
      category: "skill-repository-install",
      message: "skillRepositoryInstallSessionId=inline-install-session",
      details: {
        sessionId: "install-session-secret",
        installSessionId: "install-session-secret-2",
        skillRepositoryInstallSessionId: "install-session-secret-3",
        nested: {
          note: "sessionId=inline-session installSessionId=inline-install",
        },
      },
    })

    expect(entry.message).toContain("skillRepositoryInstallSessionId=[redacted]")
    expect(entry.details).toContain("[redacted]")
    expect(entry.message).not.toContain("inline-install-session")
    expect(entry.details).not.toContain("install-session-secret")
    expect(entry.details).not.toContain("install-session-secret-2")
    expect(entry.details).not.toContain("install-session-secret-3")
    expect(entry.details).not.toContain("inline-session")
    expect(entry.details).not.toContain("inline-install")
  })

  it("redacts bare bearer and platform tokens without removing paths", () => {
    const entry = logStore.write({
      source: "main",
      level: "warn",
      category: "agent-runtime",
      message: "request failed: Bearer abc.def.token",
      details: [
        "github_pat_1234567890",
        "ghp_1234567890",
        "glpat-1234567890",
        "sk-1234567890",
        "/Users/example/repo",
      ].join(" "),
    })

    expect(entry.message).toContain("Bearer [redacted]")
    expect(entry.message).not.toContain("abc.def.token")
    expect(entry.details).toContain("/Users/example/repo")
    expect(entry.details).not.toContain("github_pat_1234567890")
    expect(entry.details).not.toContain("ghp_1234567890")
    expect(entry.details).not.toContain("glpat-1234567890")
    expect(entry.details).not.toContain("sk-1234567890")
  })

  it("redacts bare bearer tokens from error messages and stacks", () => {
    const error = new Error("request failed: Bearer secret.bearer.token at /Users/example/repo")
    error.stack = [
      "Error: request failed: Bearer secret.bearer.token",
      "    at /Users/example/repo/file.ts:1:1",
    ].join("\n")

    const entry = logStore.write({
      source: "main",
      level: "error",
      category: "agent-runtime",
      message: error,
    })

    expect(entry.message).toContain("Bearer [redacted]")
    expect(entry.message).not.toContain("secret.bearer.token")
    expect(entry.details).toContain("/Users/example/repo/file.ts")
    expect(entry.details).not.toContain("secret.bearer.token")
  })

  it("redacts fallback stderr output", async () => {
    await logStore.dispose()
    vi.resetModules()
    electronMock.app.getPath.mockReturnValue(tempDir)
    electronMock.app.getAppPath.mockImplementationOnce(() => {
      throw new Error("app path failed token=raw-token Authorization: Bearer raw.bearer.token Cookie: session=raw sk-rawsecret")
    })
    const stderrWrite = vi.spyOn(process.stderr, "write").mockImplementation(() => true)

    try {
      const module = await import("../log-store")
      logStore = module.logStore
      await logStore.flush()
      const output = stderrWrite.mock.calls.map((call) => String(call[0])).join("")

      expect(output).toContain("[synapse-log] Failed to read app path for compatibility log.")
      expect(output).toContain("token=[redacted]")
      expect(output).toContain("Authorization: [redacted]")
      expect(output).toContain("Cookie: [redacted]")
      expect(output).not.toContain("raw-token")
      expect(output).not.toContain("raw.bearer.token")
      expect(output).not.toContain("session=raw")
      expect(output).not.toContain("sk-rawsecret")
    } finally {
      stderrWrite.mockRestore()
      electronMock.app.getAppPath.mockReset()
      electronMock.app.getAppPath.mockReturnValue("/Applications/Synapse.app")
    }
  })
})
