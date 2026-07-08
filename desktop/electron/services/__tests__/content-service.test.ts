import path from "node:path"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { DEFAULT_AGENT_GLOBAL_CONFIG } from "../../../src/constants/defaults"
import { DEFAULT_DOCK_APP_IDS } from "../../../src/modules/apps/dock"
import type { SynapseConfig, SynapseRepositoryConfig } from "../../../src/types/config"
import type { SynapseContentMeta } from "../../../src/types/content"

const mocks = vi.hoisted(() => ({
  attachmentsPoolService: {
    readAttachmentFile: vi.fn(),
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
  fsPromises: {
    readFile: vi.fn(),
    stat: vi.fn(),
  },
  logger: {
    warn: vi.fn(),
  },
  repositoryStore: {
    getRepositoryState: vi.fn(),
  },
  resolveContentDirectoryPath: vi.fn(),
}))

vi.mock("node:fs/promises", () => mocks.fsPromises)

vi.mock("../attachments-pool-service", () => ({
  attachmentsPoolService: mocks.attachmentsPoolService,
}))

vi.mock("../config-store", () => ({
  configStore: mocks.configStore,
}))

vi.mock("../content-history-service", () => ({
  contentHistoryService: mocks.contentHistoryService,
  resolveContentDirectoryPath: mocks.resolveContentDirectoryPath,
}))

vi.mock("../content-index-service", () => ({
  contentIndexService: mocks.contentIndexService,
}))

vi.mock("../log-store", () => ({
  createMainLogger: () => mocks.logger,
}))

vi.mock("../repository-store", () => ({
  repositoryStore: mocks.repositoryStore,
}))

import { contentService } from "../content-service"
import { CONTENT_ICON_IMAGE_MAX_BYTES } from "../content-capability-validator"

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
      knowledgeBaseStorage: { mode: "default" },
      dockAppIds: [...DEFAULT_DOCK_APP_IDS],
    },
    agent: structuredClone(DEFAULT_AGENT_GLOBAL_CONFIG),
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

describe("contentService.getAttachmentFile", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("reads repository attachments from the git root when active path is a subdirectory", async () => {
    const subdirRepository = {
      ...repository,
      localPath: "/repo/packages/content",
    }
    const attachment = {
      originalName: "docs/readme.md",
      sha256: "a".repeat(64),
      size: 5,
    }
    const attachmentFile = {
      relativePath: "docs/readme.md",
      name: "readme.md",
      size: 5,
      kind: "text",
      content: "hello",
    }
    mocks.configStore.load.mockResolvedValue({
      ...createConfig(),
      repositories: [subdirRepository],
    })
    mocks.repositoryStore.getRepositoryState.mockResolvedValue({
      status: "ready",
      isGitRepository: true,
      gitRootPath: "/repo",
    })
    mocks.contentHistoryService.readHistoryVersion.mockResolvedValue({
      attachments: [attachment],
    })
    mocks.attachmentsPoolService.readAttachmentFile.mockResolvedValue(attachmentFile)

    await expect(contentService.getAttachmentFile(
      "skill",
      "skill-1",
      "history-1",
      "docs/readme.md",
    )).resolves.toEqual(attachmentFile)

    expect(mocks.attachmentsPoolService.readAttachmentFile).toHaveBeenCalledWith("/repo", attachment)
  })
})

describe("contentService.readIconImage", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.configStore.load.mockResolvedValue(createConfig())
    mocks.resolveContentDirectoryPath.mockReturnValue("/repo/rules/rule-1")
    mocks.fsPromises.stat.mockResolvedValue({
      isFile: () => true,
      size: 4,
    })
    mocks.fsPromises.readFile.mockResolvedValue(Buffer.from("icon"))
  })

  it("reads a bounded content icon image", async () => {
    const iconPath = path.join("/repo/rules/rule-1", "icon.png")

    await expect(contentService.readIconImage("rule", "rule-1")).resolves.toBe(
      `data:image/png;base64,${Buffer.from("icon").toString("base64")}`,
    )

    expect(mocks.fsPromises.stat).toHaveBeenCalledWith(iconPath)
    expect(mocks.fsPromises.readFile).toHaveBeenCalledWith(iconPath)
  })

  it("skips oversized content icon images before reading the file", async () => {
    mocks.fsPromises.stat.mockResolvedValueOnce({
      isFile: () => true,
      size: CONTENT_ICON_IMAGE_MAX_BYTES + 1,
    })

    await expect(contentService.readIconImage("rule", "rule-1")).resolves.toBeNull()

    expect(mocks.fsPromises.readFile).not.toHaveBeenCalled()
    expect(mocks.logger.warn).toHaveBeenCalledWith("Skipped oversized content icon image.", {
      contentType: "rule",
      contentId: "rule-1",
      maxBytes: CONTENT_ICON_IMAGE_MAX_BYTES,
      size: CONTENT_ICON_IMAGE_MAX_BYTES + 1,
    })
  })

  it("skips content icon paths that are not files", async () => {
    mocks.fsPromises.stat.mockResolvedValueOnce({
      isFile: () => false,
      size: 0,
    })

    await expect(contentService.readIconImage("rule", "rule-1")).resolves.toBeNull()

    expect(mocks.fsPromises.readFile).not.toHaveBeenCalled()
    expect(mocks.logger.warn).toHaveBeenCalledWith(
      "Skipped content icon image because icon.png is not a file.",
      { contentType: "rule", contentId: "rule-1" },
    )
  })
})
