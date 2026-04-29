import { beforeEach, describe, expect, it, vi } from "vitest"

const electronMock = vi.hoisted(() => {
  const app = {
    on: vi.fn(),
    quit: vi.fn(),
  }

  return {
    app,
    showMessageBox: vi.fn(),
  }
})

const updateServiceMock = vi.hoisted(() => {
  const mock = {
    beforeInstallQuitHandler: null as (() => void) | null,
    cancelDownload: vi.fn(async () => {}),
    setBeforeInstallQuitHandler: vi.fn(),
  }

  mock.setBeforeInstallQuitHandler.mockImplementation((handler: (() => void) | null) => {
    mock.beforeInstallQuitHandler = handler
  })

  return mock
})

const logStoreMock = vi.hoisted(() => ({
  dispose: vi.fn(async () => {}),
  flush: vi.fn(async () => {}),
}))

vi.mock("electron", () => ({
  app: electronMock.app,
  dialog: {
    showMessageBox: electronMock.showMessageBox,
  },
}))

vi.mock("../../services/config-store", () => ({
  configStore: {
    load: vi.fn(async () => ({ repositories: [] })),
  },
}))

vi.mock("../../services/content-submission-service", () => ({
  contentSubmissionService: {
    flushPendingPushes: vi.fn(async () => {}),
  },
}))

vi.mock("../../services/log-store", () => ({
  createMainLogger: () => ({
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  }),
  logStore: logStoreMock,
}))

vi.mock("../../services/pending-pushes-service", () => ({
  pendingPushesService: {
    countAll: vi.fn(async () => 0),
  },
}))

vi.mock("../../services/update-service", () => ({
  updateService: updateServiceMock,
}))

describe("attachBeforeQuitHandler", () => {
  beforeEach(() => {
    updateServiceMock.beforeInstallQuitHandler = null
    vi.clearAllMocks()
  })

  it("allows the app to quit when installing an update", async () => {
    const { attachBeforeQuitHandler } = await import("../before-quit")
    let allowQuit = false
    const stopAll = vi.fn(async () => {})

    attachBeforeQuitHandler({
      state: { current: null },
      registry: { stopAll } as never,
      setAllowQuit: (value) => {
        allowQuit = value
      },
      isAllowedToQuit: () => allowQuit,
    })

    updateServiceMock.beforeInstallQuitHandler?.()

    expect(allowQuit).toBe(true)
    expect(stopAll).not.toHaveBeenCalled()
    expect(logStoreMock.dispose).not.toHaveBeenCalled()
  })
})
