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
    readPendingPushState: vi.fn(async () => ({ count: 1, items: [] })),
    restoreContent: vi.fn(),
    updateContent: vi.fn(),
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

vi.mock("../../../services/content-install-service", () => ({
  contentInstallService: {
    installToEditor: vi.fn(),
    readEditorInstallFormValues: vi.fn(),
  },
}))

vi.mock("../../../services/content-service", () => ({
  contentService: {
    getContent: vi.fn(),
    getDetail: vi.fn(),
    getHistory: vi.fn(),
    getHistoryVersion: vi.fn(),
    listContent: vi.fn(),
    listDeletedContent: vi.fn(),
    readIconImage: vi.fn(),
  },
}))

vi.mock("../../../services/content-submission-service", () => ({
  contentSubmissionService: mocks.contentSubmissionService,
}))

vi.mock("../../../services/content-window-service", () => ({
  contentWindowService: { openDetailWindow: vi.fn() },
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
    mocks.contentSubmissionService.readPendingPushState.mockResolvedValue({ count: 1, items: [] })
    mocks.contentSubmissionService.restoreContent.mockResolvedValue({
      status: "saved",
      pendingPushCount: 1,
    })
    mocks.contentSubmissionService.updateContent.mockResolvedValue({
      status: "saved",
      pendingPushCount: 1,
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
})
