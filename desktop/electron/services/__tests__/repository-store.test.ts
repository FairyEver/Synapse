import { beforeEach, describe, expect, it, vi } from "vitest"
import type { SynapseRepositoryConfig } from "../../../src/types/config"

const mocks = vi.hoisted(() => ({
  fsWatchers: [] as Array<{
    path: string
    listener: () => void
    watcher: {
      close: ReturnType<typeof vi.fn>
      on: ReturnType<typeof vi.fn>
    }
  }>,
  watch: vi.fn((path: string, _options: unknown, listener: () => void) => {
    const watcher = {
      close: vi.fn(),
      on: vi.fn(),
    }
    mocks.fsWatchers.push({ path, listener, watcher })
    return watcher
  }),
  logger: {
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
  pathExists: vi.fn(),
  runGitCommand: vi.fn(),
}))

vi.mock("node:fs", () => ({
  watch: mocks.watch,
}))

vi.mock("../fs-utils", () => ({
  isFileNotFoundError: vi.fn(() => false),
  isPermissionError: vi.fn(() => false),
  pathExists: mocks.pathExists,
}))

vi.mock("../git-command", () => ({
  runGitCommand: mocks.runGitCommand,
}))

vi.mock("../log-store", () => ({
  createMainLogger: () => mocks.logger,
}))

describe("RepositoryStore", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.fsWatchers.length = 0
  })

  it("restarts a repository watcher when the same uuid moves to a new localPath", async () => {
    const { RepositoryStore } = await import("../repository-store")
    const store = new RepositoryStore()

    store.watchRepository(repositoryFixture({ uuid: "repo-1", localPath: "/old-repo" }))
    store.reconcileRepositories([
      repositoryFixture({ uuid: "repo-1", localPath: "/new-repo" }),
    ])

    expect(mocks.fsWatchers).toHaveLength(2)
    expect(mocks.fsWatchers[0]?.path).toBe("/old-repo")
    expect(mocks.fsWatchers[0]?.watcher.close).toHaveBeenCalledOnce()
    expect(mocks.fsWatchers[1]?.path).toBe("/new-repo")
  })

  it("stops watchers for repositories removed from config", async () => {
    const { RepositoryStore } = await import("../repository-store")
    const store = new RepositoryStore()

    store.watchRepository(repositoryFixture({ uuid: "repo-1", localPath: "/repo-1" }))
    store.watchRepository(repositoryFixture({ uuid: "repo-2", localPath: "/repo-2" }))
    store.reconcileRepositories([
      repositoryFixture({ uuid: "repo-2", localPath: "/repo-2" }),
    ])

    expect(mocks.fsWatchers).toHaveLength(2)
    expect(mocks.fsWatchers[0]?.watcher.close).toHaveBeenCalledOnce()
    expect(mocks.fsWatchers[1]?.watcher.close).not.toHaveBeenCalled()
  })

  it("ignores stale disappeared checks after the same uuid moves to a new localPath", async () => {
    const { RepositoryStore } = await import("../repository-store")
    const store = new RepositoryStore()
    const disappeared = vi.fn()
    const pathCheck = createDeferred<boolean>()
    mocks.pathExists.mockReturnValueOnce(pathCheck.promise)
    store.onRepositoryDisappeared(disappeared)

    store.watchRepository(repositoryFixture({ uuid: "repo-1", localPath: "/old-repo" }))
    mocks.fsWatchers[0]?.listener()
    store.reconcileRepositories([
      repositoryFixture({ uuid: "repo-1", localPath: "/new-repo" }),
    ])

    await pathCheck.resolve(false)
    await Promise.resolve()

    expect(mocks.fsWatchers[0]?.watcher.close).toHaveBeenCalledOnce()
    expect(mocks.fsWatchers[1]?.watcher.close).not.toHaveBeenCalled()
    expect(disappeared).not.toHaveBeenCalled()
    expect(mocks.logger.warn).not.toHaveBeenCalledWith(
      "Watched repository directory disappeared.",
      expect.objectContaining({ repositoryUuid: "repo-1" }),
    )
  })
})

function repositoryFixture(overrides: Partial<SynapseRepositoryConfig> = {}): SynapseRepositoryConfig {
  return {
    uuid: "repo-1",
    name: "Repo",
    localPath: "/repo",
    contentDirs: {},
    ...overrides,
  }
}

function createDeferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve
    reject = promiseReject
  })
  return {
    promise,
    resolve: async (value: T) => {
      resolve(value)
      await promise
    },
    reject,
  }
}
