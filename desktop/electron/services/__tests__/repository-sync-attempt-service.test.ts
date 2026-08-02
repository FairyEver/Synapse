import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

let userDataPath = ""

vi.mock("electron", () => ({
  app: {
    getPath: vi.fn(() => userDataPath),
  },
}))

vi.mock("../log-store", () => ({
  createMainLogger: () => ({
    warn: vi.fn(),
  }),
}))

describe("repositorySyncAttemptService", () => {
  beforeEach(async () => {
    userDataPath = await mkdtemp(path.join(os.tmpdir(), "synapse-sync-attempt-"))
    vi.resetModules()
  })

  afterEach(async () => {
    await rm(userDataPath, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 })
  })

  it("persists one repository-level failure independently of pending rows", async () => {
    const { repositorySyncAttemptService } = await import("../repository-sync-attempt-service")

    await repositorySyncAttemptService.markAttempt("repo-1", "2026-05-02T00:00:00.000Z")
    await repositorySyncAttemptService.markFailure("repo-1", {
      category: "network",
      lastError: "网络不可用，稍后自动重试。",
      nextRetryAt: "2026-05-02T00:01:00.000Z",
    })

    vi.resetModules()
    const { repositorySyncAttemptService: reloadedService } = await import("../repository-sync-attempt-service")

    await expect(reloadedService.read("repo-1")).resolves.toEqual({
      lastAttemptAt: "2026-05-02T00:00:00.000Z",
      lastError: "网络不可用，稍后自动重试。",
      lastErrorCategory: "network",
      nextRetryAt: "2026-05-02T00:01:00.000Z",
      retryCount: 1,
    })
  })

  it("clears the persisted failure state", async () => {
    const { repositorySyncAttemptService } = await import("../repository-sync-attempt-service")
    await repositorySyncAttemptService.markFailure("repo-1", {
      category: "auth",
      lastError: "Git 认证失败。",
      nextRetryAt: null,
    })

    await expect(repositorySyncAttemptService.clear("repo-1")).resolves.toEqual({
      lastAttemptAt: null,
      lastError: null,
      lastErrorCategory: null,
      nextRetryAt: null,
      retryCount: 0,
    })
    await expect(repositorySyncAttemptService.read("repo-1")).resolves.toEqual({
      lastAttemptAt: null,
      lastError: null,
      lastErrorCategory: null,
      nextRetryAt: null,
      retryCount: 0,
    })
  })
})
