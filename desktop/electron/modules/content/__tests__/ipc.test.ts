import path from "node:path"
import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  coordinator: {
    requestPush: vi.fn(async () => undefined),
  },
  eventBus: {
    emit: vi.fn(),
  },
  logger: {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
  repository: {
    uuid: "repo-1",
    name: "Repo",
    localPath: "/repo",
    contentDirs: {},
  },
  contentSubmissionService: {
    createContent: vi.fn(),
    deleteContent: vi.fn(),
    purgeContent: vi.fn(),
    readPendingPushState: vi.fn(async () => ({ count: 1, items: [] })),
    restoreContent: vi.fn(),
    updateContent: vi.fn(),
  },
  editorInstallService: {
    installToEditor: vi.fn(),
  },
  contentService: {
    getDetail: vi.fn(),
    getAttachmentFile: vi.fn(),
  },
  installStatusCacheService: {
    refresh: vi.fn(),
  },
  auditSink: {
    record: vi.fn(),
  },
  permissionGuard: {
    check: vi.fn(),
  },
}))

vi.mock("electron", () => ({
  app: {
    getPath: vi.fn(() => "/tmp"),
  },
  dialog: {
    showSaveDialog: vi.fn(),
  },
}))

vi.mock("../../../../src/config/content-types", () => ({
  getContentTypeDefinition: vi.fn(() => ({ download: { extension: ".md", dialogFilterName: "Markdown" } })),
}))

vi.mock("../../../../src/lib/config", () => ({
  getActiveRepositoryConfig: vi.fn(() => mocks.repository),
}))

vi.mock("../../../services/config-store", () => ({
  configStore: {
    load: vi.fn(async () => ({ activeRepoUuid: "repo-1", repositories: [mocks.repository], global: {} })),
  },
}))

vi.mock("../../../services/content-download-service", () => ({
  contentDownloadService: { download: vi.fn() },
}))

vi.mock("../../../services/editor-install-service", () => ({
  editorInstallService: {
    installToEditor: mocks.editorInstallService.installToEditor,
    readEditorInstallFormValues: vi.fn(),
  },
}))

vi.mock("../../../services/install-status-cache-service", () => ({
  installStatusCacheService: mocks.installStatusCacheService,
}))

vi.mock("../../../services/content-service", () => ({
  contentService: {
    getContent: vi.fn(),
    getDetail: mocks.contentService.getDetail,
    getAttachmentFile: mocks.contentService.getAttachmentFile,
    listContent: vi.fn(),
    listDeletedContent: vi.fn(),
    readIconImage: vi.fn(),
  },
}))

vi.mock("../../../services/content-submission-service", () => ({
  contentSubmissionService: mocks.contentSubmissionService,
}))

vi.mock("../../../services/content-window-service", () => ({
  contentWindowService: {
    openCreateWindow: vi.fn(),
    openDetailWindow: vi.fn(),
    openEditWindow: vi.fn(),
    readPendingEditorPayload: vi.fn(),
  },
}))

vi.mock("../../../services/editor-adapter-service", () => ({
  editorAdapterService: {
    listAdapters: vi.fn(),
    resolveTarget: vi.fn(),
  },
}))

vi.mock("../../../services/log-store", () => ({
  createMainLogger: () => mocks.logger,
}))

function createContext(options: { failCoordinatorResolve?: boolean } = {}) {
  return {
    moduleId: "content",
    resolve: vi.fn((id: string) => {
      if (id === "core.event-bus") {
        return mocks.eventBus
      }
      if (id === "repo.sync-coordinator" && !options.failCoordinatorResolve) {
        return mocks.coordinator
      }
      if (id === "core.audit-sink") {
        return mocks.auditSink
      }
      if (id === "core.permission-guard") {
        return mocks.permissionGuard
      }
      throw new Error(`Unexpected service id: ${id}`)
    }),
  }
}

function createDeferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve
    reject = promiseReject
  })

  return { promise, reject, resolve }
}

async function flushAsyncWork(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve))
}

function getEvents(type: string) {
  return mocks.eventBus.emit.mock.calls
    .map(([event]) => event)
    .filter((event) => event.type === type)
}

describe("contentIpcModule sync ownership", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.contentSubmissionService.createContent.mockResolvedValue({
      status: "saved",
      pendingPushCount: 1,
    })
    mocks.contentSubmissionService.deleteContent.mockResolvedValue({
      status: "saved",
      pendingPushCount: 1,
    })
    mocks.contentSubmissionService.purgeContent.mockResolvedValue({
      status: "saved",
      pendingPushCount: 1,
    })
    mocks.contentSubmissionService.readPendingPushState.mockResolvedValue({ count: 1, items: [] })
    mocks.contentSubmissionService.restoreContent.mockResolvedValue({
      status: "saved",
      pendingPushCount: 1,
    })
    mocks.contentSubmissionService.updateContent.mockResolvedValue({
      status: "saved",
      pendingPushCount: 1,
    })
    mocks.editorInstallService.installToEditor.mockResolvedValue({ installed: true })
    mocks.contentService.getAttachmentFile.mockResolvedValue({
      content: "export default {}",
      kind: "text",
      name: "scripts/audit.ts",
      relativePath: "scripts/audit.ts",
      size: 17,
    })
    mocks.contentService.getDetail.mockResolvedValue({
      id: "rule-1",
      title: "Rule",
    })
    mocks.permissionGuard.check.mockResolvedValue({ allowed: true })
    mocks.installStatusCacheService.refresh.mockResolvedValue([{
      editorId: "codex",
      projectName: "Project",
      projectPath: "/project",
      scope: "project",
      status: "installed",
    }])
  })

  it("delegates attachment file preview requests to the content service", async () => {
    const { contentIpcModule } = await import("../ipc")

    const result = await contentIpcModule.methods.getAttachmentFile.handler(createContext() as never, {
      contentType: "skill",
      historyDirname: "20260522000000Z__user__abc123",
      id: "skill-1",
      originalName: "scripts/audit.ts",
    } as never)

    expect(mocks.contentService.getAttachmentFile).toHaveBeenCalledWith(
      "skill",
      "skill-1",
      "20260522000000Z__user__abc123",
      "scripts/audit.ts",
    )
    expect(result).toMatchObject({
      content: "export default {}",
      kind: "text",
      relativePath: "scripts/audit.ts",
    })
  })

  it("records failed audit when content download write fails after permission is allowed", async () => {
    const { dialog } = await import("electron")
    const { contentDownloadService } = await import("../../../services/content-download-service")
    const { contentIpcModule } = await import("../ipc")
    vi.mocked(dialog.showSaveDialog).mockResolvedValueOnce({
      canceled: false,
      filePath: "/tmp/rule.md",
    })
    vi.mocked(contentDownloadService.download).mockRejectedValueOnce(new Error("disk full"))

    await expect(contentIpcModule.methods.download.handler(createContext() as never, {
      contentType: "rule",
      id: "rule-1",
    })).rejects.toThrow("disk full")

    expect(mocks.permissionGuard.check).toHaveBeenCalledWith(expect.objectContaining({
      action: "fs.write",
      resource: "/tmp/rule.md",
    }))
    expect(mocks.auditSink.record).toHaveBeenCalledWith(expect.objectContaining({
      action: "fs.write",
      outcome: "allowed",
      resource: "/tmp/rule.md",
    }))
    expect(mocks.auditSink.record).toHaveBeenCalledWith(expect.objectContaining({
      action: "fs.write",
      outcome: "failed",
      resource: "/tmp/rule.md",
      metadata: expect.objectContaining({
        contentId: "rule-1",
        contentType: "rule",
        errorLength: "Error: disk full".length,
        errorName: "Error",
      }),
    }))
  })

  it("uses a Windows-safe default file name for content downloads", async () => {
    const { dialog } = await import("electron")
    const { contentIpcModule } = await import("../ipc")
    mocks.contentService.getDetail.mockResolvedValueOnce({
      id: "rule-1",
      title: "CON",
    })
    vi.mocked(dialog.showSaveDialog).mockResolvedValueOnce({
      canceled: true,
      filePath: "",
    })

    await contentIpcModule.methods.download.handler(createContext() as never, {
      contentType: "rule",
      id: "rule-1",
    })

    expect(dialog.showSaveDialog).toHaveBeenCalledWith(expect.objectContaining({
      defaultPath: path.join("/tmp", "_CON.md"),
    }))
  })

  it.each([
    ["create", "createContent"],
    ["update", "updateContent"],
    ["restore", "restoreContent"],
  ] as const)("requests one coordinator push after %s saves with pending pushes", async (methodName, serviceName) => {
    const { contentIpcModule } = await import("../ipc")
    const method = contentIpcModule.methods[methodName]

    await method.handler(createContext() as never, {
      contentType: "rule",
      payload: { title: "Rule" },
      type: "rule",
      id: "rule-1",
    } as never)

    expect(mocks.contentSubmissionService[serviceName]).toHaveBeenCalledTimes(1)
    expect(mocks.coordinator.requestPush).toHaveBeenCalledTimes(1)
    expect(mocks.coordinator.requestPush).toHaveBeenCalledWith(mocks.repository, "content-saved")
  })

  it("does not log user-provided titles when creating content", async () => {
    const { contentIpcModule } = await import("../ipc")
    const secretTitle = "客户 Alpha 事故复盘"

    await contentIpcModule.methods.create.handler(createContext() as never, {
      contentType: "prompt",
      payload: { title: secretTitle },
    } as never)

    expect(mocks.logger.info).toHaveBeenCalledWith("Handling content.create request.", {
      contentType: "prompt",
    })
    expect(JSON.stringify(mocks.logger.info.mock.calls)).not.toContain(secretTitle)
  })

  it("validates mutating content IPC request shapes with Zod schemas", async () => {
    const { contentIpcModule } = await import("../ipc")
    const contentPayload = {
      category: "General",
      content: "body",
      description: "description",
      icon: "FileText",
      iconBg: "default",
      iconImage: "",
      iconType: "icon",
      title: "Rule",
    }

    expect(contentIpcModule.methods.create.request.safeParse({
      contentType: "rule",
      payload: { ...contentPayload, name: "rule-name" },
    }).success).toBe(true)
    expect(contentIpcModule.methods.create.request.safeParse({
      contentType: "rule",
      payload: { title: "missing required fields" },
    }).success).toBe(false)
    expect(contentIpcModule.methods.update.request.safeParse({
      contentType: "rule",
      payload: { ...contentPayload, baseHistoryDirname: "history", id: "rule-1", name: "rule-name" },
    }).success).toBe(true)
    expect(contentIpcModule.methods.update.request.safeParse({
      contentType: "rule",
      payload: { ...contentPayload, name: "rule-name" },
    }).success).toBe(false)
    expect(contentIpcModule.methods.deleteContent.request.safeParse({
      baseHistoryDirname: "history",
      id: "rule-1",
      type: "rule",
    }).success).toBe(true)
    expect(contentIpcModule.methods.restore.request.safeParse({
      id: "rule-1",
      type: "rule",
    }).success).toBe(false)
    expect(contentIpcModule.methods.openDetailWindow.request.safeParse({
      contentType: "rule",
      id: "rule-1",
      title: "Rule",
      viewMode: "rendered",
    }).success).toBe(true)
    expect(contentIpcModule.methods.installToEditor.request.safeParse({
      contentId: "skill-1",
      contentType: "skill",
      editorId: "codex",
      overwriteConfirmed: true,
      scope: "project",
    }).success).toBe(true)
    expect(contentIpcModule.methods.installToEditor.request.parse({
      contentId: "skill-1",
      contentType: "skill",
      editorId: "codex",
      scope: "project",
      skillEnvValues: { TOKEN: "saved-token" },
    })).toEqual(expect.objectContaining({
      skillEnvValues: { TOKEN: "saved-token" },
    }))
    expect(contentIpcModule.methods.readEditorInstallFormValues.request.safeParse({
      editorId: "codex",
    }).success).toBe(false)
  })

  it("emits legacy push completion events after coordinator push succeeds", async () => {
    const { contentIpcModule } = await import("../ipc")
    const push = createDeferred<undefined>()
    mocks.coordinator.requestPush.mockReturnValueOnce(push.promise)
    mocks.contentSubmissionService.readPendingPushState
      .mockResolvedValueOnce({ count: 1, items: [] })
      .mockResolvedValueOnce({ count: 0, items: [] })

    await contentIpcModule.methods.create.handler(createContext() as never, {
      contentType: "rule",
      payload: { title: "Rule" },
    } as never)
    push.resolve(undefined)
    await flushAsyncWork()

    const pendingEvents = getEvents("repository.pendingPushesUpdated")
    const updatedEvents = getEvents("repository.updated")

    expect(pendingEvents).toHaveLength(2)
    expect(pendingEvents[1].payload).toEqual({
      repositoryUuid: "repo-1",
      pendingPushes: { count: 0, items: [] },
    })
    expect(updatedEvents).toHaveLength(1)
    expect(updatedEvents[0].payload).toMatchObject({
      repositoryUuid: "repo-1",
      operation: "push",
      message: "同步完成。",
    })
    expect(updatedEvents[0].payload.error).toBeUndefined()
  })

  it("coalesces legacy push completion events for merged in-flight coordinator requests", async () => {
    const { contentIpcModule } = await import("../ipc")
    const push = createDeferred<undefined>()
    mocks.coordinator.requestPush.mockReturnValue(push.promise)
    mocks.contentSubmissionService.readPendingPushState
      .mockResolvedValueOnce({ count: 1, items: [] })
      .mockResolvedValueOnce({ count: 1, items: [] })
      .mockResolvedValueOnce({ count: 0, items: [] })

    await contentIpcModule.methods.create.handler(createContext() as never, {
      contentType: "rule",
      payload: { title: "First" },
    } as never)
    await contentIpcModule.methods.update.handler(createContext() as never, {
      contentType: "rule",
      payload: { id: "rule-1", title: "Second" },
    } as never)

    expect(mocks.coordinator.requestPush).toHaveBeenCalledTimes(2)

    push.resolve(undefined)
    await flushAsyncWork()

    const pendingEvents = getEvents("repository.pendingPushesUpdated")
    const updatedEvents = getEvents("repository.updated")

    expect(pendingEvents).toHaveLength(3)
    expect(pendingEvents[2].payload).toEqual({
      repositoryUuid: "repo-1",
      pendingPushes: { count: 0, items: [] },
    })
    expect(updatedEvents).toHaveLength(1)
    expect(updatedEvents[0].payload).toMatchObject({
      repositoryUuid: "repo-1",
      operation: "push",
      message: "同步完成。",
    })
  })

  it("emits legacy completion events for a follow-up coordinator push with a different promise", async () => {
    const { contentIpcModule } = await import("../ipc")
    const firstPush = createDeferred<undefined>()
    const secondPush = createDeferred<undefined>()
    mocks.coordinator.requestPush
      .mockReturnValueOnce(firstPush.promise)
      .mockReturnValueOnce(secondPush.promise)
    mocks.contentSubmissionService.readPendingPushState
      .mockResolvedValueOnce({ count: 2, items: [] })
      .mockResolvedValueOnce({ count: 2, items: [] })
      .mockResolvedValueOnce({ count: 1, items: [] })
      .mockResolvedValueOnce({ count: 0, items: [] })

    await contentIpcModule.methods.create.handler(createContext() as never, {
      contentType: "rule",
      payload: { title: "First" },
    } as never)
    await contentIpcModule.methods.update.handler(createContext() as never, {
      contentType: "rule",
      payload: { id: "rule-1", title: "Second" },
    } as never)

    firstPush.resolve(undefined)
    await flushAsyncWork()
    secondPush.resolve(undefined)
    await flushAsyncWork()

    const pendingEvents = getEvents("repository.pendingPushesUpdated")
    const updatedEvents = getEvents("repository.updated")

    expect(pendingEvents).toHaveLength(4)
    expect(pendingEvents[2].payload.pendingPushes).toEqual({ count: 1, items: [] })
    expect(pendingEvents[3].payload.pendingPushes).toEqual({ count: 0, items: [] })
    expect(updatedEvents).toHaveLength(2)
    expect(updatedEvents[0].payload).toMatchObject({
      repositoryUuid: "repo-1",
      operation: "push",
      message: "同步完成。",
    })
    expect(updatedEvents[1].payload).toMatchObject({
      repositoryUuid: "repo-1",
      operation: "push",
      message: "同步完成。",
    })
  })

  it("emits legacy push error events after coordinator push fails", async () => {
    const { contentIpcModule } = await import("../ipc")
    const push = createDeferred<undefined>()
    mocks.coordinator.requestPush.mockReturnValueOnce(push.promise)

    await contentIpcModule.methods.create.handler(createContext() as never, {
      contentType: "rule",
      payload: { title: "Rule" },
    } as never)
    push.reject(new Error("offline"))
    await flushAsyncWork()

    const pendingEvents = getEvents("repository.pendingPushesUpdated")
    const updatedEvents = getEvents("repository.updated")

    expect(pendingEvents).toHaveLength(2)
    expect(updatedEvents).toHaveLength(1)
    expect(updatedEvents[0].payload).toMatchObject({
      repositoryUuid: "repo-1",
      operation: "push",
      error: "offline",
      message: "offline",
    })
  })

  it("does not reject the create handler when coordinator push rejects", async () => {
    const { contentIpcModule } = await import("../ipc")
    const expectedResult = {
      status: "saved",
      pendingPushCount: 1,
    }
    mocks.contentSubmissionService.createContent.mockResolvedValueOnce(expectedResult)
    mocks.coordinator.requestPush.mockRejectedValueOnce(new Error("offline"))

    await expect(contentIpcModule.methods.create.handler(createContext() as never, {
      contentType: "rule",
      payload: { title: "Rule" },
    } as never)).resolves.toBe(expectedResult)

    await flushAsyncWork()

    expect(mocks.logger.warn).toHaveBeenCalledWith(
      "Failed to request content-saved repository push.",
      expect.objectContaining({ repositoryUuid: "repo-1" }),
    )
  })

  it("does not reject the create handler when coordinator resolution fails", async () => {
    const { contentIpcModule } = await import("../ipc")
    const expectedResult = {
      status: "saved",
      pendingPushCount: 1,
    }
    mocks.contentSubmissionService.createContent.mockResolvedValueOnce(expectedResult)

    await expect(contentIpcModule.methods.create.handler(createContext({ failCoordinatorResolve: true }) as never, {
      contentType: "rule",
      payload: { title: "Rule" },
    } as never)).resolves.toBe(expectedResult)
    await flushAsyncWork()

    expect(mocks.logger.warn).toHaveBeenCalledWith(
      "Failed to schedule content-saved repository push.",
      expect.objectContaining({ repositoryUuid: "repo-1" }),
    )

    const updatedEvents = getEvents("repository.updated")

    expect(updatedEvents).toHaveLength(1)
    expect(updatedEvents[0].payload).toMatchObject({
      repositoryUuid: "repo-1",
      operation: "push",
      error: "Unexpected service id: repo.sync-coordinator",
      message: "Unexpected service id: repo.sync-coordinator",
    })
  })

  it.each([
    ["create", "createContent", { contentType: "rule", payload: { title: "Rule" } }],
    ["update", "updateContent", { contentType: "rule", payload: { id: "rule-1", title: "Rule" } }],
    ["deleteContent", "deleteContent", { id: "rule-1", type: "rule" }],
    ["restore", "restoreContent", { id: "rule-1", type: "rule" }],
    ["purge", "purgeContent", { id: "rule-1", type: "rule", baseHistoryDirname: "history-1" }],
  ] as const)("returns the %s result when pending push refresh fails", async (methodName, serviceName, payload) => {
    const { contentIpcModule } = await import("../ipc")
    const expectedResult = {
      status: "saved",
      pendingPushCount: 1,
    }
    mocks.contentSubmissionService[serviceName].mockResolvedValueOnce(expectedResult)
    mocks.contentSubmissionService.readPendingPushState.mockRejectedValueOnce(new Error("cache unavailable"))

    await expect(contentIpcModule.methods[methodName].handler(createContext() as never, payload as never))
      .resolves.toBe(expectedResult)

    expect(mocks.logger.warn).toHaveBeenCalledWith(
      "Failed to refresh pending pushes after content mutation.",
      expect.objectContaining({ repositoryUuid: "repo-1" }),
    )
  })

  it("emits content.changed after create saves", async () => {
    const { contentIpcModule } = await import("../ipc")
    mocks.contentSubmissionService.createContent.mockResolvedValueOnce({
      id: "rule-1",
      latestHistoryDirname: "20260522000000Z__user__abc123",
      modifiedAt: "2026-05-22T12:00:00.000Z",
      pendingPushCount: 0,
      status: "saved",
      title: "Rule",
      type: "rule",
    })

    await contentIpcModule.methods.create.handler(createContext() as never, {
      contentType: "rule",
      payload: { title: "Rule" },
    } as never)

    expect(mocks.eventBus.emit).toHaveBeenCalledWith(expect.objectContaining({
      domain: "content",
      type: "content.changed",
      payload: {
        contentId: "rule-1",
        contentType: "rule",
        latestHistoryDirname: "20260522000000Z__user__abc123",
        modifiedAt: "2026-05-22T12:00:00.000Z",
        operation: "create",
      },
    }))
  })

  it.each([
    ["deleteContent", "deleteContent", "delete", { id: "rule-1", type: "rule", baseHistoryDirname: "history-1" }],
    ["restore", "restoreContent", "restore", { id: "rule-1", type: "rule" }],
    ["purge", "purgeContent", "purge", { id: "rule-1", type: "rule", baseHistoryDirname: "history-1" }],
  ] as const)("emits content.changed after %s saves", async (methodName, serviceName, operation, payload) => {
    const { contentIpcModule } = await import("../ipc")
    mocks.contentSubmissionService[serviceName].mockResolvedValueOnce({
      id: "rule-1",
      latestHistoryDirname: "20260522000000Z__user__abc123",
      modifiedAt: "2026-05-22T12:00:00.000Z",
      pendingPushCount: 0,
      status: "saved",
      title: "Rule",
      type: "rule",
    })

    await contentIpcModule.methods[methodName].handler(createContext() as never, payload as never)

    expect(mocks.eventBus.emit).toHaveBeenCalledWith(expect.objectContaining({
      domain: "content",
      type: "content.changed",
      payload: {
        contentId: "rule-1",
        contentType: "rule",
        latestHistoryDirname: "20260522000000Z__user__abc123",
        modifiedAt: "2026-05-22T12:00:00.000Z",
        operation,
      },
    }))
  })

  it("does not emit content.changed after update conflicts", async () => {
    const { contentIpcModule } = await import("../ipc")
    mocks.contentSubmissionService.updateContent.mockResolvedValueOnce({
      id: "rule-1",
      latestHistoryDirname: "20260522000000Z__user__abc123",
      latestModifiedAt: "2026-05-22T12:00:00.000Z",
      latestModifiedByDisplayName: "User",
      status: "conflict",
      type: "rule",
    })

    await contentIpcModule.methods.update.handler(createContext() as never, {
      contentType: "rule",
      payload: { id: "rule-1", title: "Rule" },
    } as never)

    expect(getEvents("content.changed")).toHaveLength(0)
  })

  it("refreshes and broadcasts install status after project editor install succeeds", async () => {
    const { contentIpcModule } = await import("../ipc")

    await contentIpcModule.methods.installToEditor.handler(createContext() as never, {
      contentId: "skill-1",
      contentType: "skill",
      editorId: "codex",
      projectPath: "/project",
      scope: "project",
    } as never)

    expect(mocks.installStatusCacheService.refresh).toHaveBeenCalledWith("skill-1")
    expect(mocks.eventBus.emit).toHaveBeenCalledWith(expect.objectContaining({
      domain: "install-status",
      type: "install-status.changed",
      payload: {
        contentId: "skill-1",
        entries: [{
          editorId: "codex",
          projectName: "Project",
          projectPath: "/project",
          scope: "project",
          status: "installed",
        }],
      },
    }))
  })

  it("refreshes replaced Skill install status after conflict replacement succeeds", async () => {
    const { contentIpcModule } = await import("../ipc")
    mocks.installStatusCacheService.refresh.mockImplementation(async (contentId: string) => {
      if (contentId === "old-skill") return []
      return [{
        editorId: "codex",
        projectName: "Project",
        projectPath: "/project",
        scope: "project",
        status: "installed",
      }]
    })

    await contentIpcModule.methods.installToEditor.handler(createContext() as never, {
      contentId: "skill-1",
      contentType: "skill",
      editorId: "codex",
      projectPath: "/project",
      replacedContentId: "old-skill",
      replaceConfirmed: true,
      scope: "project",
    } as never)

    expect(mocks.installStatusCacheService.refresh).toHaveBeenCalledWith("skill-1")
    expect(mocks.installStatusCacheService.refresh).toHaveBeenCalledWith("old-skill")
    expect(mocks.eventBus.emit).toHaveBeenCalledWith(expect.objectContaining({
      domain: "install-status",
      type: "install-status.changed",
      payload: {
        contentId: "old-skill",
        entries: [],
      },
    }))
  })

  it("keeps install success when install status refresh fails", async () => {
    const { contentIpcModule } = await import("../ipc")
    mocks.installStatusCacheService.refresh.mockRejectedValueOnce(new Error("scan failed"))

    const result = await contentIpcModule.methods.installToEditor.handler(createContext() as never, {
      contentId: "skill-1",
      contentType: "skill",
      editorId: "codex",
      projectPath: "/project",
      scope: "project",
    } as never)

    expect(result).toEqual({ installed: true })
    expect(mocks.editorInstallService.installToEditor).toHaveBeenCalled()
    expect(mocks.installStatusCacheService.refresh).toHaveBeenCalledWith("skill-1")
    expect(getEvents("install-status.changed")).toHaveLength(0)
    expect(mocks.logger.warn).toHaveBeenCalledWith(
      "Failed to refresh install status after content change.",
      expect.objectContaining({ contentId: "skill-1" }),
    )
  })

  it("refreshes and broadcasts install status after a skill update succeeds", async () => {
    const { contentIpcModule } = await import("../ipc")

    await contentIpcModule.methods.update.handler(createContext() as never, {
      contentType: "skill",
      payload: {
        id: "skill-1",
        title: "Updated Skill",
      },
    } as never)

    expect(mocks.installStatusCacheService.refresh).toHaveBeenCalledWith("skill-1")
    expect(mocks.eventBus.emit).toHaveBeenCalledWith(expect.objectContaining({
      domain: "install-status",
      type: "install-status.changed",
      payload: {
        contentId: "skill-1",
        entries: [{
          editorId: "codex",
          projectName: "Project",
          projectPath: "/project",
          scope: "project",
          status: "installed",
        }],
      },
    }))
  })
})
