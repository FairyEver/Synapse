import { afterEach, describe, expect, it, vi } from "vitest"

import type { SynapseRepositoryConfig } from "../../../src/types/config"

const mocks = vi.hoisted(() => ({
  listRepoProfiles: vi.fn(),
  readCurrentSummary: vi.fn(),
  runGitCommand: vi.fn(),
  withRepositoryCacheDatabase: vi.fn(),
}))

vi.mock("../content-history-service", () => ({
  contentHistoryService: {
    listContent: vi.fn(),
    readCurrentSummary: mocks.readCurrentSummary,
  },
}))

vi.mock("../git-command", () => ({
  runGitCommand: mocks.runGitCommand,
}))

vi.mock("../repository-cache-database", () => ({
  withRepositoryCacheDatabase: mocks.withRepositoryCacheDatabase,
}))

vi.mock("../user-profile-service", () => ({
  userProfileService: {
    listRepoProfiles: mocks.listRepoProfiles,
  },
}))

import { contentIndexService } from "../content-index-service"

const repository = {
  uuid: "repo-1",
  localPath: "/repo",
  contentDirs: {
    rule: "rules",
    skill: "skills",
    prompt: "prompts",
  },
} as SynapseRepositoryConfig

function createDatabase() {
  return {
    exec: vi.fn(),
    prepare: vi.fn((sql: string) => ({
      all: vi.fn(() => []),
      get: vi.fn(() => sql.includes("index_meta") ? { value: "old-sha" } : undefined),
      run: vi.fn(),
    })),
  }
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.clearAllMocks()
})

describe("contentIndexService.syncIndex", () => {
  it("falls back to a full rebuild when reading a changed summary fails", async () => {
    const database = createDatabase()
    mocks.withRepositoryCacheDatabase.mockImplementation(async (_repositoryUuid, callback) => callback(database))
    mocks.runGitCommand.mockImplementation(async ({ args }: { args: string[] }) => ({
      stdout: args[0] === "rev-parse" ? "new-sha\n" : "rules/rule-a/index.md\n",
    }))
    mocks.listRepoProfiles.mockResolvedValue(new Map())
    mocks.readCurrentSummary.mockRejectedValue(new Error("broken content"))
    const rebuildIndex = vi.spyOn(contentIndexService, "rebuildIndex").mockResolvedValue(undefined)

    await expect(contentIndexService.syncIndex(repository)).resolves.toBeUndefined()

    expect(mocks.readCurrentSummary).toHaveBeenCalledWith(repository, "rule", "rule-a")
    expect(rebuildIndex).toHaveBeenCalledWith(repository)
  })
})
