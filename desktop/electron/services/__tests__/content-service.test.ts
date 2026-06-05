import { beforeEach, describe, expect, it, vi } from "vitest"
import type { SynapseConfig, SynapseRepositoryConfig } from "../../../src/types/config"
import type { SynapseContentMeta } from "../../../src/types/content"

const mocks = vi.hoisted(() => ({
  attachmentsPoolService: {
    readAttachmentFile: vi.fn(),
  },
  builtinContentService: {
    getAttachmentFile: vi.fn(),
    getContent: vi.fn(),
    getDetail: vi.fn(),
    isBuiltinContentId: vi.fn(),
    listContent: vi.fn(),
  },
  configStore: {
    load: vi.fn(),
  },
  contentHistoryService: {
    readCurrentDetail: vi.fn(),
    readHistoryVersion: vi.fn(),
  },
  contentIndexService: {
    listContent: vi.fn(),
    listDeletedContent: vi.fn(),
    syncIndex: vi.fn(),
  },
  logger: {
    warn: vi.fn(),
  },
}))

vi.mock("../attachments-pool-service", () => ({
  attachmentsPoolService: mocks.attachmentsPoolService,
}))

vi.mock("../builtin-content-service", () => ({
  builtinContentService: mocks.builtinContentService,
}))

vi.mock("../config-store", () => ({
  configStore: mocks.configStore,
}))

vi.mock("../content-history-service", () => ({
  contentHistoryService: mocks.contentHistoryService,
  resolveContentDirectoryPath: vi.fn(),
}))

vi.mock("../content-index-service", () => ({
  contentIndexService: mocks.contentIndexService,
}))

vi.mock("../log-store", () => ({
  createMainLogger: () => mocks.logger,
}))

import { contentService } from "../content-service"

const repository: SynapseRepositoryConfig = {
  uuid: "repo-1",
  name: "Repo",
  localPath: "/repo",
  contentDirs: {
    rule: "rules",
  },
}

function createConfig(): SynapseConfig {
  return {
    activeRepoUuid: repository.uuid,
    repositories: [repository],
    global: {
      contentSortOrder: "modified-desc",
      favorites: {
        prompt: [],
        rule: [],
        skill: [],
      },
      projects: [],
      quickInputs: [],
      defaultQuickInputsSeededVersion: null,
      recentlyViewed: {
        prompt: [],
        rule: [],
        skill: [],
      },
      themeMode: "system",
      variables: [],
    },
    agent: {
      defaultPermissionMode: "default",
      defaultProviderModel: null,
    },
  }
}

function createRuleMeta(overrides: Partial<SynapseContentMeta<"rule">> = {}): SynapseContentMeta<"rule"> {
  return {
    attachmentCount: 0,
    category: "General",
    createdAt: "2026-01-01T00:00:00.000Z",
    createdBy: "user",
    createdByDisplayName: "User",
    deleted: true,
    description: "Description",
    icon: "file-text",
    iconBg: "default",
    id: "rule-1",
    latestHistoryDirname: "20260101000000Z__user__abc123",
    modifiedAt: "2026-01-01T00:00:00.000Z",
    modifiedBy: "user",
    modifiedByDisplayName: "User",
    title: "Rule",
    type: "rule",
    ...overrides,
  }
}

describe("contentService.listDeletedContent", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.configStore.load.mockResolvedValue(createConfig())
    mocks.contentIndexService.syncIndex.mockResolvedValue(undefined)
    mocks.contentIndexService.listDeletedContent.mockResolvedValue([])
  })

  it("returns repository deleted content after syncing the index", async () => {
    const deletedRule = createRuleMeta()
    mocks.contentIndexService.listDeletedContent.mockResolvedValue([deletedRule])

    await expect(contentService.listDeletedContent("rule")).resolves.toEqual([deletedRule])

    expect(mocks.contentIndexService.syncIndex).toHaveBeenCalledWith(repository)
    expect(mocks.contentIndexService.listDeletedContent).toHaveBeenCalledWith(repository, "rule")
    expect(mocks.logger.warn).not.toHaveBeenCalled()
  })

  it("returns an empty list when index sync fails", async () => {
    const error = new Error("git index failed")
    mocks.contentIndexService.syncIndex.mockRejectedValue(error)

    await expect(contentService.listDeletedContent("rule")).resolves.toEqual([])

    expect(mocks.contentIndexService.listDeletedContent).not.toHaveBeenCalled()
    expect(mocks.logger.warn).toHaveBeenCalledWith(
      "Failed to load deleted repository content, returning empty list.",
      { contentType: "rule", error },
    )
  })
})
