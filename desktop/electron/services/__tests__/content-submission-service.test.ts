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
    userId: "user-1",
  },
  contentHistoryService: {
    readCurrentDetail: vi.fn(),
  },
  contentIndexService: {
    syncIndex: vi.fn(),
  },
  contentWriteService: {
    createContent: vi.fn(),
    deleteContent: vi.fn(),
    purgeContent: vi.fn(),
    restoreContent: vi.fn(),
    updateContent: vi.fn(),
  },
  configStore: {
    load: vi.fn(),
  },
  repositoryStore: {
    getRepositoryState: vi.fn(),
  },
  pendingPushesService: {
    clear: vi.fn(),
    enqueue: vi.fn(),
    markFailure: vi.fn(),
    readState: vi.fn(),
  },
  repositoryLockManager: {
    acquire: vi.fn(),
  },
  isGitRebaseInProgress: vi.fn(),
  runGitCommand: vi.fn(),
  userIdentityService: {
    requireReadyRepoProfile: vi.fn(),
  },
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
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

vi.mock("../config-store", () => ({
  configStore: mocks.configStore,
}))

vi.mock("../git-command", () => ({
  isGitRebaseInProgress: mocks.isGitRebaseInProgress,
  runGitCommand: mocks.runGitCommand,
}))

vi.mock("../log-store", () => ({
  createMainLogger: () => mocks.logger,
}))

vi.mock("../pending-pushes-service", () => ({
  pendingPushesService: mocks.pendingPushesService,
}))

vi.mock("../repository-maintenance-service", () => ({
  repositoryMaintenanceService: {
    maybeRunAfterPush: vi.fn(),
  },
}))

vi.mock("../repository-lock-manager", () => ({
  repositoryLockManager: mocks.repositoryLockManager,
}))

vi.mock("../repository-store", () => ({
  repositoryStore: mocks.repositoryStore,
}))

vi.mock("../user-identity-service", () => ({
  userIdentityService: mocks.userIdentityService,
}))

function createWriteTransactionMock() {
  return {
    id: "transaction-1",
    finalize: vi.fn(),
    markCommitted: vi.fn(),
    markCommitting: vi.fn(),
    moveDirectoryToRecovery: vi.fn(),
    recordCreatedPath: vi.fn(),
    replaceFile: vi.fn(),
    rollback: vi.fn(),
  }
}

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
    mocks.runGitCommand.mockImplementation(async (input: { args: string[] }) => ({
      stdout: input.args[0] === "rev-parse" && input.args[1] === "--git-path"
        ? "/tmp/synapse-content-test-index\n"
        : input.args[0] === "rev-parse"
          ? "commit-1\n"
          : "",
      stderr: "",
    }))
    mocks.userIdentityService.requireReadyRepoProfile.mockResolvedValue(mocks.identity)
    mocks.contentIndexService.syncIndex.mockResolvedValue(undefined)
    mocks.contentWriteService.createContent.mockResolvedValue({
      id: "rule-1",
      type: "rule",
      title: "Rule",
      latestHistoryDirname: "history-1",
      modifiedAt: "2026-05-20T12:00:00.000Z",
      gitPaths: ["/repo/rules/rule-1.md"],
      transaction: createWriteTransactionMock(),
    })
    mocks.contentHistoryService.readCurrentDetail.mockResolvedValue({
      createdBy: "user-1",
      latestHistoryDirname: "remote-new",
      modifiedAt: "2026-05-20T12:00:00.000Z",
      modifiedByDisplayName: "Remote User",
    })
    mocks.pendingPushesService.clear.mockResolvedValue(undefined)
    mocks.pendingPushesService.enqueue.mockResolvedValue({
      count: 1,
      items: [{
        id: "pending-1",
        action: "create",
        commitHash: "commit-1",
        targetId: "rule-1",
        title: "Rule",
        createdAt: "2026-05-20T12:00:00.000Z",
      }],
    })
    mocks.pendingPushesService.markFailure.mockResolvedValue(undefined)
    mocks.pendingPushesService.readState.mockResolvedValue({ count: 0, items: [] })
    mocks.repositoryLockManager.acquire.mockResolvedValue(vi.fn())
    mocks.isGitRebaseInProgress.mockResolvedValue(false)
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
      args: ["pull", "--rebase"],
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

  it("does not abort a rebase that existed before content sync", async () => {
    const { contentSubmissionService } = await import("../content-submission-service")
    mocks.isGitRebaseInProgress.mockResolvedValueOnce(true)

    await expect(contentSubmissionService.updateContent({
      contentType: "rule",
      payload: {
        id: "rule-1",
        title: "Rule",
        baseHistoryDirname: "local-old",
      },
    } as never))
      .rejects
      .toThrow("当前仓库正在进行 rebase")

    expect(mocks.runGitCommand).not.toHaveBeenCalledWith(expect.objectContaining({
      args: ["pull", "--rebase"],
    }))
    expect(mocks.runGitCommand).not.toHaveBeenCalledWith(expect.objectContaining({
      args: ["rebase", "--abort"],
    }))
  })

  it("pulls and syncs before purge conflict detection", async () => {
    const { contentSubmissionService } = await import("../content-submission-service")
    mocks.contentHistoryService.readCurrentDetail.mockResolvedValueOnce({
      createdBy: "user-1",
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
      args: ["pull", "--rebase"],
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
      createdBy: "user-1",
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

  it.each([
    ["deleteContent", "deleteContent", "删除"],
    ["restoreContent", "restoreContent", "恢复"],
    ["purgeContent", "purgeContent", "永久删除"],
  ] as const)("rejects %s for a Skill created by another user", async (serviceMethod, writerMethod, actionLabel) => {
    const { contentSubmissionService } = await import("../content-submission-service")
    mocks.contentHistoryService.readCurrentDetail.mockResolvedValueOnce({
      createdBy: "other-user",
      deleted: true,
      latestHistoryDirname: "history-1",
      modifiedAt: "2026-05-20T12:00:00.000Z",
      modifiedByDisplayName: "Other User",
    })

    await expect(contentSubmissionService[serviceMethod]({
      id: "skill-1",
      type: "skill",
      baseHistoryDirname: "history-1",
    } as never)).rejects.toThrow(`只有创建者可以${actionLabel} Skill。`)

    expect(mocks.contentWriteService[writerMethod]).not.toHaveBeenCalled()
  })

  it.each([
    ["rule", "规则"],
    ["prompt", "Prompt"],
  ] as const)("rejects an update to another user's %s before conflict disclosure", async (contentType, contentLabel) => {
    const { contentSubmissionService } = await import("../content-submission-service")
    mocks.contentHistoryService.readCurrentDetail.mockResolvedValueOnce({
      createdBy: "other-user",
      latestHistoryDirname: "remote-new",
      modifiedAt: "2026-05-20T12:00:00.000Z",
      modifiedByDisplayName: "Other User",
    })

    await expect(contentSubmissionService.updateContent({
      contentType,
      payload: {
        id: `${contentType}-1`,
        title: contentLabel,
        baseHistoryDirname: "local-old",
      },
    } as never)).rejects.toThrow(`只有创建者可以更新 ${contentLabel}。`)

    expect(mocks.contentWriteService.updateContent).not.toHaveBeenCalled()
  })

  it("allows a collaborator to update a Skill", async () => {
    const { contentSubmissionService } = await import("../content-submission-service")
    mocks.repositoryStore.getRepositoryState.mockResolvedValue({
      status: "ready",
      isGitRepository: false,
      gitRootPath: null,
    })
    mocks.contentHistoryService.readCurrentDetail.mockResolvedValueOnce({
      createdBy: "other-user",
      latestHistoryDirname: "history-1",
      modifiedAt: "2026-05-20T12:00:00.000Z",
      modifiedByDisplayName: "Other User",
    })
    mocks.contentWriteService.updateContent.mockResolvedValueOnce({
      gitPaths: ["/repo/skills/skill-1"],
      id: "skill-1",
      latestHistoryDirname: "history-2",
      modifiedAt: "2026-05-20T12:01:00.000Z",
      title: "Skill",
      transaction: createWriteTransactionMock(),
      type: "skill",
    })

    await expect(contentSubmissionService.updateContent({
      contentType: "skill",
      payload: {
        id: "skill-1",
        title: "Skill",
        baseHistoryDirname: "history-1",
      },
    } as never)).resolves.toMatchObject({ status: "saved" })

    expect(mocks.contentWriteService.updateContent).toHaveBeenCalled()
  })

  it.each([
    ["deleteContent", "deleteContent", "rule", "规则", "删除"],
    ["restoreContent", "restoreContent", "prompt", "Prompt", "恢复"],
    ["purgeContent", "purgeContent", "rule", "规则", "永久删除"],
  ] as const)("rejects %s for another user's %s", async (serviceMethod, writerMethod, contentType, contentLabel, actionLabel) => {
    const { contentSubmissionService } = await import("../content-submission-service")
    mocks.contentHistoryService.readCurrentDetail.mockResolvedValueOnce({
      createdBy: "other-user",
      deleted: true,
      latestHistoryDirname: "history-1",
      modifiedAt: "2026-05-20T12:00:00.000Z",
      modifiedByDisplayName: "Other User",
    })

    await expect(contentSubmissionService[serviceMethod]({
      id: `${contentType}-1`,
      type: contentType,
      baseHistoryDirname: "history-1",
    } as never)).rejects.toThrow(`只有创建者可以${actionLabel} ${contentLabel}。`)

    expect(mocks.contentWriteService[writerMethod]).not.toHaveBeenCalled()
  })

  it.each([
    ["deleteContent", "deleteContent"],
    ["restoreContent", "restoreContent"],
    ["purgeContent", "purgeContent"],
  ] as const)("allows the Skill creator to use %s", async (serviceMethod, writerMethod) => {
    const { contentSubmissionService } = await import("../content-submission-service")
    mocks.repositoryStore.getRepositoryState.mockResolvedValue({
      status: "ready",
      isGitRepository: false,
      gitRootPath: null,
    })
    mocks.contentHistoryService.readCurrentDetail.mockResolvedValue({
      createdBy: "user-1",
      deleted: true,
      latestHistoryDirname: "history-1",
      modifiedAt: "2026-05-20T12:00:00.000Z",
      modifiedByDisplayName: "User",
    })
    mocks.contentWriteService[writerMethod].mockResolvedValueOnce({
      gitPaths: ["/repo/skills/skill-1"],
      id: "skill-1",
      latestHistoryDirname: "history-2",
      modifiedAt: "2026-05-20T12:01:00.000Z",
      title: "Skill",
      transaction: createWriteTransactionMock(),
      type: "skill",
    })

    await expect(contentSubmissionService[serviceMethod]({
      id: "skill-1",
      type: "skill",
      baseHistoryDirname: "history-1",
    } as never)).resolves.toMatchObject({ status: "saved" })

    expect(mocks.contentWriteService[writerMethod]).toHaveBeenCalled()
  })

  it("returns saved content when syncIndex fails after a git commit", async () => {
    const { contentSubmissionService } = await import("../content-submission-service")
    const syncError = new Error("index database locked")
    mocks.contentIndexService.syncIndex.mockRejectedValueOnce(syncError)

    const result = await contentSubmissionService.createContent({
      contentType: "rule",
      payload: {
        title: "Rule",
        body: "content",
      },
    } as never)

    expect(result).toEqual(expect.objectContaining({
      id: "rule-1",
      type: "rule",
      status: "saved",
      pushed: false,
      pendingPushCount: 1,
    }))
    expect(mocks.pendingPushesService.enqueue).toHaveBeenCalled()
    expect(mocks.logger.warn).toHaveBeenCalledWith("commitAndMaybePush: syncIndex failed after git mutation.", {
      action: "create",
      error: syncError,
      repositoryUuid: "repo-1",
    })
  })

  it.each([
    ["createContent", "createContent", { contentType: "rule", payload: { title: "Rule" } }],
    ["updateContent", "updateContent", { contentType: "rule", payload: { id: "rule-1", title: "Rule", baseHistoryDirname: "history-1" } }],
    ["deleteContent", "deleteContent", { id: "rule-1", type: "rule", baseHistoryDirname: "history-1" }],
    ["restoreContent", "restoreContent", { id: "rule-1", type: "rule", baseHistoryDirname: "history-1" }],
    ["purgeContent", "purgeContent", { id: "rule-1", type: "rule", baseHistoryDirname: "history-1" }],
  ] as const)("rolls back %s when the Git commit fails", async (serviceMethod, writerMethod, request) => {
    const transaction = {
      id: "transaction-1",
      finalize: vi.fn(),
      markCommitted: vi.fn(),
      markCommitting: vi.fn(),
      moveDirectoryToRecovery: vi.fn(),
      recordCreatedPath: vi.fn(),
      replaceFile: vi.fn(),
      rollback: vi.fn(),
    }
    mocks.contentHistoryService.readCurrentDetail.mockResolvedValue({
      createdBy: "user-1",
      deleted: serviceMethod === "restoreContent" || serviceMethod === "purgeContent",
      latestHistoryDirname: "history-1",
      modifiedAt: "2026-05-20T12:00:00.000Z",
      modifiedByDisplayName: "User",
    })
    mocks.contentWriteService[writerMethod].mockReset().mockResolvedValue({
      id: "rule-1",
      type: "rule",
      title: "Rule",
      latestHistoryDirname: "history-2",
      modifiedAt: "2026-05-20T12:01:00.000Z",
      gitPaths: ["/repo/rules/rule-1"],
      transaction,
    })
    mocks.runGitCommand.mockImplementation(async (input: { args: string[] }) => {
      if (input.args.includes("commit")) throw new Error("pre-commit rejected")
      return {
        stdout: input.args[0] === "rev-parse" && input.args[1] === "--git-path"
          ? "/tmp/synapse-content-test-index\n"
          : input.args[0] === "rev-parse"
            ? "commit-1\n"
            : "",
        stderr: "",
      }
    })
    const { contentSubmissionService } = await import("../content-submission-service")

    await expect(contentSubmissionService[serviceMethod](request as never)).rejects.toThrow("pre-commit rejected")

    expect(transaction.markCommitting).toHaveBeenCalledTimes(1)
    expect(transaction.rollback).toHaveBeenCalledTimes(1)
    expect(transaction.markCommitted).not.toHaveBeenCalled()
    expect(transaction.finalize).not.toHaveBeenCalled()
  })

  it("returns an explicit recovery-needed error when automatic rollback fails", async () => {
    const transaction = {
      id: "transaction-1",
      finalize: vi.fn(),
      markCommitted: vi.fn(),
      markCommitting: vi.fn(),
      moveDirectoryToRecovery: vi.fn(),
      recordCreatedPath: vi.fn(),
      replaceFile: vi.fn(),
      rollback: vi.fn().mockRejectedValue(new Error("recovery material locked")),
    }
    mocks.contentWriteService.createContent.mockResolvedValueOnce({
      id: "rule-1",
      type: "rule",
      title: "Rule",
      latestHistoryDirname: "history-2",
      modifiedAt: "2026-05-20T12:01:00.000Z",
      gitPaths: ["/repo/rules/rule-1"],
      transaction,
    })
    mocks.runGitCommand.mockImplementation(async (input: { args: string[] }) => {
      if (input.args.includes("commit")) throw new Error("pre-commit rejected")
      return {
        stdout: input.args[0] === "rev-parse" && input.args[1] === "--git-path"
          ? "/tmp/synapse-content-test-index\n"
          : input.args[0] === "rev-parse"
            ? "commit-1\n"
            : "",
        stderr: "",
      }
    })
    const { contentSubmissionService } = await import("../content-submission-service")

    await expect(contentSubmissionService.createContent({
      contentType: "rule",
      payload: { title: "Rule" },
    } as never)).rejects.toThrow("下次启动时继续恢复")

    expect(transaction.rollback).toHaveBeenCalledTimes(1)
  })

  it("finalizes recovery state instead of rolling back after Git has already created the commit", async () => {
    const transaction = {
      id: "transaction-1",
      finalize: vi.fn(),
      markCommitted: vi.fn(),
      markCommitting: vi.fn(),
      moveDirectoryToRecovery: vi.fn(),
      recordCreatedPath: vi.fn(),
      replaceFile: vi.fn(),
      rollback: vi.fn(),
    }
    mocks.contentWriteService.createContent.mockResolvedValueOnce({
      id: "rule-1",
      type: "rule",
      title: "Rule",
      latestHistoryDirname: "history-2",
      modifiedAt: "2026-05-20T12:01:00.000Z",
      gitPaths: ["/repo/rules/rule-1"],
      transaction,
    })
    mocks.runGitCommand.mockImplementation(async (input: { args: string[] }) => {
      if (input.args.includes("reset")) throw new Error("index locked")
      return {
        stdout: input.args[0] === "rev-parse" && input.args[1] === "--git-path"
          ? "/tmp/synapse-content-test-index\n"
          : input.args[0] === "rev-parse"
            ? "commit-created\n"
            : "",
        stderr: "",
      }
    })
    const { contentSubmissionService } = await import("../content-submission-service")

    await expect(contentSubmissionService.createContent({
      contentType: "rule",
      payload: { title: "Rule" },
    } as never)).rejects.toThrow("提交已创建")

    expect(transaction.markCommitted).toHaveBeenCalledWith("commit-created")
    expect(transaction.finalize).toHaveBeenCalledTimes(1)
    expect(transaction.rollback).not.toHaveBeenCalled()
  })

  it("holds the real Git-root lock through write, commit, and pending registration", async () => {
    const release = vi.fn()
    mocks.repositoryLockManager.acquire.mockResolvedValueOnce(release)
    const { contentSubmissionService } = await import("../content-submission-service")

    await contentSubmissionService.createContent({
      contentType: "rule",
      payload: { title: "Rule", body: "content" },
    } as never)

    expect(mocks.repositoryLockManager.acquire).toHaveBeenCalledWith("/repo", "content.create")
    expect(mocks.repositoryLockManager.acquire.mock.invocationCallOrder[0])
      .toBeLessThan(mocks.contentWriteService.createContent.mock.invocationCallOrder[0])
    expect(mocks.contentWriteService.createContent.mock.invocationCallOrder[0])
      .toBeLessThan(mocks.pendingPushesService.enqueue.mock.invocationCallOrder[0])
    expect(release).toHaveBeenCalledTimes(1)
  })

  it("returns recovery-needed when pending registration fails after commit", async () => {
    mocks.pendingPushesService.enqueue.mockRejectedValueOnce(new Error("pending database unavailable"))
    mocks.runGitCommand.mockImplementation(async (input: { args: string[] }) => ({
      stdout: input.args[0] === "rev-list"
        ? "2\n"
        : input.args[0] === "rev-parse" && input.args[1] === "--git-path"
          ? "/tmp/synapse-content-test-index\n"
          : input.args[0] === "rev-parse"
            ? "commit-1\n"
            : "",
      stderr: "",
    }))
    const { contentSubmissionService } = await import("../content-submission-service")

    await expect(contentSubmissionService.createContent({
      contentType: "rule",
      payload: { title: "Rule", body: "content" },
    } as never)).resolves.toMatchObject({
      status: "saved",
      syncStatus: "recovery-needed",
      pendingPushCount: 2,
      pushed: false,
    })
  })

  it("does not fail pending push flush when syncIndex fails after push records are cleared", async () => {
    const { contentSubmissionService } = await import("../content-submission-service")
    const syncError = new Error("index database locked")
    mocks.pendingPushesService.readState.mockResolvedValueOnce({
      count: 1,
      items: [{
        id: "pending-1",
        action: "create",
        commitHash: "commit-1",
        targetId: "rule-1",
        title: "Rule",
        createdAt: "2026-05-20T12:00:00.000Z",
      }],
    })
    mocks.contentIndexService.syncIndex.mockRejectedValueOnce(syncError)

    await expect(contentSubmissionService.flushPendingPushes(mocks.repository))
      .resolves
      .toBeUndefined()

    expect(mocks.pendingPushesService.clear).toHaveBeenCalledWith(mocks.repository, ["pending-1"])
    expect(mocks.pendingPushesService.markFailure).not.toHaveBeenCalled()
    expect(mocks.logger.warn).toHaveBeenCalledWith("flushPendingPushes: syncIndex failed after git mutation.", {
      error: syncError,
      repositoryUuid: "repo-1",
    })
  })
})
