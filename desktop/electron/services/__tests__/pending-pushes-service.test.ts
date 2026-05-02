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

describe("pendingPushesService", () => {
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
    await rm(userDataPath, { recursive: true, force: true })
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
})
