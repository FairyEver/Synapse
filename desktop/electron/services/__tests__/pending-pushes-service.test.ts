import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { SynapseRepositoryConfig } from "../../../src/types/config"

let userDataPath = ""

vi.mock("electron", () => ({
  app: {
    getPath: vi.fn(() => userDataPath),
  },
}))

vi.mock("../repository-store", () => ({
  repositoryStore: {
    getRepositoryState: vi.fn(async (repository: SynapseRepositoryConfig) => ({
      repositoryUuid: repository.uuid,
      localPath: repository.localPath,
      status: "ready",
      isGitRepository: true,
      gitRootPath: repository.localPath,
    })),
  },
}))

describe("pendingPushesService", { timeout: 15_000 }, () => {
  const repository: SynapseRepositoryConfig = {
    uuid: "repo-1",
    name: "Repo",
    localPath: "/repo",
    contentDirs: {},
  }

  beforeEach(async () => {
    userDataPath = await mkdtemp(path.join(os.tmpdir(), "synapse-pending-"))
    vi.resetModules()
  })

  afterEach(async () => {
    await rm(userDataPath, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 })
  })

  it("persists retry metadata", async () => {
    const { pendingPushesService } = await import("../pending-pushes-service")
    const enqueued = await pendingPushesService.enqueue(repository, {
      action: "update",
      commitHash: "abc",
      targetId: "rule-1",
      title: "Rule",
    })

    await pendingPushesService.markAttempt(
      repository,
      "2026-05-02T00:00:00.000Z",
      [enqueued.items[0].id],
    )
    await pendingPushesService.markFailure(repository, "网络不可用", [enqueued.items[0].id], {
      category: "network",
      nextRetryAt: "2026-05-02T00:01:00.000Z",
    })

    const state = await pendingPushesService.readState(repository)

    expect(state.items[0]).toMatchObject({
      retryCount: 1,
      lastError: "网络不可用",
      lastErrorCategory: "network",
      lastAttemptAt: "2026-05-02T00:00:00.000Z",
      nextRetryAt: "2026-05-02T00:01:00.000Z",
    })
  })

  it("updates only selected pending push ids", async () => {
    const { pendingPushesService } = await import("../pending-pushes-service")
    const first = await pendingPushesService.enqueue(repository, {
      action: "update",
      commitHash: "abc",
      targetId: "rule-1",
      title: "Rule 1",
    })
    const second = await pendingPushesService.enqueue(repository, {
      action: "update",
      commitHash: "def",
      targetId: "rule-2",
      title: "Rule 2",
    })
    const selectedId = first.items[0].id
    const unselectedId = second.items.find((item) => item.id !== selectedId)?.id

    expect(unselectedId).toBeDefined()

    await pendingPushesService.markAttempt(
      repository,
      "2026-05-02T00:02:00.000Z",
      [selectedId],
    )
    await pendingPushesService.markFailure(repository, "timeout", [selectedId], {
      category: "network",
      nextRetryAt: "2026-05-02T00:03:00.000Z",
    })

    const state = await pendingPushesService.readState(repository)
    const selected = state.items.find((item) => item.id === selectedId)
    const unselected = state.items.find((item) => item.id === unselectedId)

    expect(selected).toMatchObject({
      retryCount: 1,
      lastError: "timeout",
      lastErrorCategory: "network",
      lastAttemptAt: "2026-05-02T00:02:00.000Z",
      nextRetryAt: "2026-05-02T00:03:00.000Z",
    })
    expect(unselected).toMatchObject({
      retryCount: 0,
      lastError: null,
      lastErrorCategory: null,
      lastAttemptAt: null,
      nextRetryAt: null,
    })
  })

  it("ignores invalid-only pending push ids", async () => {
    const { pendingPushesService } = await import("../pending-pushes-service")
    await pendingPushesService.enqueue(repository, {
      action: "update",
      commitHash: "abc",
      targetId: "rule-1",
      title: "Rule 1",
    })
    await pendingPushesService.enqueue(repository, {
      action: "update",
      commitHash: "def",
      targetId: "rule-2",
      title: "Rule 2",
    })
    const invalidIds = [0, -1, Number.NaN]

    await pendingPushesService.markAttempt(
      repository,
      "2026-05-02T00:04:00.000Z",
      invalidIds,
    )
    await pendingPushesService.markFailure(repository, "timeout", invalidIds, {
      category: "network",
      nextRetryAt: "2026-05-02T00:05:00.000Z",
    })
    await pendingPushesService.clear(repository, invalidIds)

    const state = await pendingPushesService.readState(repository)

    expect(state.count).toBe(2)
    expect(state.items).toEqual([
      expect.objectContaining({
        retryCount: 0,
        lastError: null,
        lastErrorCategory: null,
        lastAttemptAt: null,
        nextRetryAt: null,
      }),
      expect.objectContaining({
        retryCount: 0,
        lastError: null,
        lastErrorCategory: null,
        lastAttemptAt: null,
        nextRetryAt: null,
      }),
    ])
  })
})
