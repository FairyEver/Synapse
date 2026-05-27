import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  repository: {
    uuid: "repo-1",
    name: "Repo",
    localPath: "/repo",
    contentDirs: {},
  },
  identity: {
    displayName: "User",
    email: "user@example.com",
  },
  contentHistoryService: {
    readCurrentDetail: vi.fn(),
  },
  contentIndexService: {
    syncIndex: vi.fn(),
  },
  contentWriteService: {
    purgeContent: vi.fn(),
    updateContent: vi.fn(),
  },
  configStore: {
    load: vi.fn(),
  },
  repositoryStore: {
    getRepositoryState: vi.fn(),
  },
  runGitCommand: vi.fn(),
  userIdentityService: {
    requireReadyRepoProfile: vi.fn(),
  },
}))

vi.mock("../content-history-service", () => ({
  contentHistoryService: mocks.contentHistoryService,
}))

vi.mock("../content-index-service", () => ({
  contentIndexService: mocks.contentIndexService,
}))

vi.mock("../content-write-service", () => ({
  contentWriteService: mocks.contentWriteService,
}))

vi.mock("../builtin-content-service", () => ({
  builtinContentService: {
    isBuiltinContentId: vi.fn(() => false),
  },
}))

vi.mock("../config-store", () => ({
  configStore: mocks.configStore,
}))

vi.mock("../git-command", () => ({
  runGitCommand: mocks.runGitCommand,
}))

vi.mock("../log-store", () => ({
  createMainLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
  }),
}))

vi.mock("../pending-pushes-service", () => ({
  pendingPushesService: {
    enqueue: vi.fn(),
    readState: vi.fn(),
  },
}))

vi.mock("../repository-maintenance-service", () => ({
  repositoryMaintenanceService: {
    maybeRunAfterPush: vi.fn(),
  },
}))

vi.mock("../repository-store", () => ({
  repositoryStore: mocks.repositoryStore,
}))

vi.mock("../user-identity-service", () => ({
  userIdentityService: mocks.userIdentityService,
}))

describe("contentSubmissionService", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.configStore.load.mockResolvedValue({
      activeRepoUuid: "repo-1",
      repositories: [mocks.repository],
    })
    mocks.repositoryStore.getRepositoryState.mockResolvedValue({
      status: "ready",
      isGitRepository: true,
      gitRootPath: "/repo",
    })
    mocks.runGitCommand.mockResolvedValue({
      stdout: "",
      stderr: "",
    })
    mocks.userIdentityService.requireReadyRepoProfile.mockResolvedValue(mocks.identity)
    mocks.contentIndexService.syncIndex.mockResolvedValue(undefined)
    mocks.contentHistoryService.readCurrentDetail.mockResolvedValue({
      latestHistoryDirname: "remote-new",
      modifiedAt: "2026-05-20T12:00:00.000Z",
      modifiedByDisplayName: "Remote User",
    })
  })

  it("pulls and syncs before update conflict detection", async () => {
    const { contentSubmissionService } = await import("../content-submission-service")

    const result = await contentSubmissionService.updateContent({
      contentType: "rule",
      payload: {
        id: "rule-1",
        title: "Rule",
        baseHistoryDirname: "local-old",
      },
    } as never)

    expect(mocks.runGitCommand).toHaveBeenCalledWith(expect.objectContaining({
      args: ["pull", "--rebase", "-X", "theirs"],
      cwd: "/repo",
    }))
    expect(mocks.contentIndexService.syncIndex).toHaveBeenCalledWith(mocks.repository)
    expect(mocks.contentHistoryService.readCurrentDetail).toHaveBeenCalledWith(
      mocks.repository,
      "rule",
      "rule-1",
    )
    expect(mocks.runGitCommand.mock.invocationCallOrder[0])
      .toBeLessThan(mocks.contentIndexService.syncIndex.mock.invocationCallOrder[0])
    expect(mocks.contentIndexService.syncIndex.mock.invocationCallOrder[0])
      .toBeLessThan(mocks.contentHistoryService.readCurrentDetail.mock.invocationCallOrder[0])
    expect(mocks.contentWriteService.updateContent).not.toHaveBeenCalled()
    expect(result).toEqual({
      id: "rule-1",
      type: "rule",
      status: "conflict",
      latestHistoryDirname: "remote-new",
      latestModifiedAt: "2026-05-20T12:00:00.000Z",
      latestModifiedByDisplayName: "Remote User",
    })
  })

  it("pulls and syncs before purge conflict detection", async () => {
    const { contentSubmissionService } = await import("../content-submission-service")
    mocks.contentHistoryService.readCurrentDetail.mockResolvedValueOnce({
      latestHistoryDirname: "remote-new",
      modifiedAt: "2026-05-20T12:00:00.000Z",
      modifiedByDisplayName: "Remote User",
      deleted: true,
    })

    const result = await contentSubmissionService.purgeContent({
      id: "rule-1",
      type: "rule",
      baseHistoryDirname: "local-old",
    })

    expect(mocks.runGitCommand).toHaveBeenCalledWith(expect.objectContaining({
      args: ["pull", "--rebase", "-X", "theirs"],
      cwd: "/repo",
    }))
    expect(mocks.contentIndexService.syncIndex).toHaveBeenCalledWith(mocks.repository)
    expect(mocks.contentHistoryService.readCurrentDetail).toHaveBeenCalledWith(
      mocks.repository,
      "rule",
      "rule-1",
    )
    expect(mocks.runGitCommand.mock.invocationCallOrder[0])
      .toBeLessThan(mocks.contentIndexService.syncIndex.mock.invocationCallOrder[0])
    expect(mocks.contentIndexService.syncIndex.mock.invocationCallOrder[0])
      .toBeLessThan(mocks.contentHistoryService.readCurrentDetail.mock.invocationCallOrder[0])
    expect(mocks.contentWriteService.purgeContent).not.toHaveBeenCalled()
    expect(result).toEqual({
      id: "rule-1",
      type: "rule",
      status: "conflict",
      latestHistoryDirname: "remote-new",
      latestModifiedAt: "2026-05-20T12:00:00.000Z",
      latestModifiedByDisplayName: "Remote User",
    })
  })

  it("does not purge content that is no longer deleted after sync", async () => {
    const { contentSubmissionService } = await import("../content-submission-service")
    mocks.contentHistoryService.readCurrentDetail.mockResolvedValueOnce({
      latestHistoryDirname: "local-old",
      modifiedAt: "2026-05-20T12:00:00.000Z",
      modifiedByDisplayName: "Remote User",
      deleted: false,
    })

    const result = await contentSubmissionService.purgeContent({
      id: "rule-1",
      type: "rule",
      baseHistoryDirname: "local-old",
    })

    expect(mocks.contentWriteService.purgeContent).not.toHaveBeenCalled()
    expect(result).toEqual({
      id: "rule-1",
      type: "rule",
      status: "conflict",
      latestHistoryDirname: "local-old",
      latestModifiedAt: "2026-05-20T12:00:00.000Z",
      latestModifiedByDisplayName: "Remote User",
    })
  })
})
