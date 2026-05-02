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

vi.mock("../../../src/config/content-types", () => ({
  getContentTypeDefinition: vi.fn(() => ({ download: { extension: ".md", dialogFilterName: "Markdown" } })),
}))

vi.mock("../../../src/lib/config", () => ({
  getActiveRepositoryConfig: vi.fn(() => mocks.repository),
}))

vi.mock("../../services/config-store", () => ({
  configStore: {
    load: vi.fn(async () => ({ activeRepoUuid: "repo-1", repositories: [mocks.repository], global: {} })),
  },
}))

vi.mock("../../services/content-download-service", () => ({
  contentDownloadService: { download: vi.fn() },
}))

vi.mock("../../services/content-install-service", () => ({
  contentInstallService: {
    installToEditor: vi.fn(),
    readEditorInstallFormValues: vi.fn(),
  },
}))

vi.mock("../../services/content-service", () => ({
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

vi.mock("../../services/content-submission-service", () => ({
  contentSubmissionService: mocks.contentSubmissionService,
}))

vi.mock("../../services/content-window-service", () => ({
  contentWindowService: { openDetailWindow: vi.fn() },
}))

vi.mock("../../services/editor-adapter-service", () => ({
  editorAdapterService: {
    listAdapters: vi.fn(),
    resolveTarget: vi.fn(),
  },
}))

vi.mock("../../services/log-store", () => ({
  createMainLogger: () => mocks.logger,
}))

function createContext() {
  return {
    moduleId: "content",
    resolve: vi.fn((id: string) => {
      if (id === "core.event-bus") {
        return mocks.eventBus
      }
      if (id === "repo.sync-coordinator") {
        return mocks.coordinator
      }
      throw new Error(`Unexpected service id: ${id}`)
    }),
  }
}

describe("contentIpcModule sync ownership", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.contentSubmissionService.createContent.mockResolvedValue({
      status: "saved",
      pendingPushCount: 1,
    })
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
    const { contentIpcModule } = await import("./ipc")
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

  it("does not reject the create handler when coordinator push rejects", async () => {
    const { contentIpcModule } = await import("./ipc")
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

    await new Promise((resolve) => setImmediate(resolve))

    expect(mocks.logger.warn).toHaveBeenCalledWith(
      "Failed to request content-saved repository push.",
      expect.objectContaining({ repositoryUuid: "repo-1" }),
    )
  })
})
