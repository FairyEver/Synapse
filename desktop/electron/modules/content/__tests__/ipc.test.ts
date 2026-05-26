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
  contentInstallService: {
    installToEditor: vi.fn(),
  },
  contentService: {
    getAttachmentFile: vi.fn(),
  },
  installStatusCacheService: {
    refresh: vi.fn(),
  },
  auditSink: {},
  permissionGuard: {},
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

vi.mock("../../../services/content-install-service", () => ({
  contentInstallService: {
    installToEditor: mocks.contentInstallService.installToEditor,
    readEditorInstallFormValues: vi.fn(),
  },
}))

vi.mock("../../../services/install-status-cache-service", () => ({
  installStatusCacheService: mocks.installStatusCacheService,
}))

vi.mock("../../../services/content-service", () => ({
  contentService: {
    getContent: vi.fn(),
    getDetail: vi.fn(),
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
    mocks.contentInstallService.installToEditor.mockResolvedValue({ installed: true })
    mocks.contentService.getAttachmentFile.mockResolvedValue({
      content: "export default {}",
      kind: "text",
      name: "scripts/audit.ts",
      relativePath: "scripts/audit.ts",
      size: 17,
    })
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
    ["purge", "purgeContent", { id: "rule-1", type: "rule" }],
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
