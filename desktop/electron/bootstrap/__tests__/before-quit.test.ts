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

vi.mock("../../services/log-store", () => ({
  createMainLogger: () => ({
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  }),
  logStore: logStoreMock,
}))

vi.mock("../../services/update-service", () => ({
  updateService: updateServiceMock,
}))

describe("attachBeforeQuitHandler", () => {
  beforeEach(() => {
    updateServiceMock.beforeInstallQuitHandler = null
    vi.clearAllMocks()
    vi.useRealTimers()
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

  it("flushes pending pushes through the coordinator before quit when requested", async () => {
    const { configStore } = await import("../../services/config-store")
    const { attachBeforeQuitHandler } = await import("../before-quit")
    const repository = {
      uuid: "repo-1",
      name: "Repo",
      localPath: "/repo",
      contentDirs: {},
    }
    const coordinator = {
      countAllPending: vi.fn(async () => 1),
      requestPush: vi.fn(async () => undefined),
    }
    vi.mocked(configStore.load).mockResolvedValueOnce({
      activeRepoUuid: "repo-1",
      repositories: [repository],
      global: {},
    } as never)
    electronMock.showMessageBox.mockResolvedValueOnce({ response: 0 } as never)
    let allowQuit = false
    const stopAll = vi.fn(async () => {})

    attachBeforeQuitHandler({
      state: { current: null },
      registry: {
        get: vi.fn((id: string) => {
          if (id === "repo.sync-coordinator") {
            return coordinator
          }
          throw new Error(`Unexpected service id: ${id}`)
        }),
        stopAll,
      } as never,
      setAllowQuit: (value) => {
        allowQuit = value
      },
      isAllowedToQuit: () => allowQuit,
    })
    const beforeQuitHandler = electronMock.app.on.mock.calls.find(
      ([eventName]) => eventName === "before-quit",
    )?.[1] as (event: { preventDefault: () => void }) => Promise<void>

    await beforeQuitHandler({ preventDefault: vi.fn() })
    await new Promise((resolve) => setImmediate(resolve))

    expect(coordinator.requestPush).toHaveBeenCalledTimes(1)
    expect(coordinator.requestPush).toHaveBeenCalledWith(
      expect.objectContaining({ uuid: "repo-1" }),
      "quit",
    )
    expect(allowQuit).toBe(true)
  })

  it("does not call quit twice when the timeout fires before the flow settles", async () => {
    vi.useFakeTimers()
    const { attachBeforeQuitHandler } = await import("../before-quit")
    const coordinator = {
      countAllPending: vi.fn(async () => 0),
      requestPush: vi.fn(async () => undefined),
    }
    let allowQuit = false

    attachBeforeQuitHandler({
      state: { current: null },
      registry: {
        get: vi.fn(() => coordinator),
        stopAll: vi.fn(async () => {}),
      } as never,
      setAllowQuit: (value) => {
        allowQuit = value
      },
      isAllowedToQuit: () => allowQuit,
    })
    const beforeQuitHandler = electronMock.app.on.mock.calls.find(
      ([eventName]) => eventName === "before-quit",
    )?.[1] as (event: { preventDefault: () => void }) => Promise<void>

    await beforeQuitHandler({ preventDefault: vi.fn() })
    vi.advanceTimersByTime(15_000)
    await vi.runAllTimersAsync()

    expect(electronMock.app.quit).toHaveBeenCalledTimes(1)
  })

  it("shows a fallback prompt when the sync coordinator is unavailable", async () => {
    const { attachBeforeQuitHandler } = await import("../before-quit")
    electronMock.showMessageBox.mockResolvedValueOnce({ response: 0 } as never)
    let allowQuit = false

    attachBeforeQuitHandler({
      state: { current: null },
      registry: {
        get: vi.fn(() => {
          throw new Error("Service not running")
        }),
        stopAll: vi.fn(async () => {}),
      } as never,
      setAllowQuit: (value) => {
        allowQuit = value
      },
      isAllowedToQuit: () => allowQuit,
    })
    const beforeQuitHandler = electronMock.app.on.mock.calls.find(
      ([eventName]) => eventName === "before-quit",
    )?.[1] as (event: { preventDefault: () => void }) => Promise<void>

    await beforeQuitHandler({ preventDefault: vi.fn() })
    await new Promise((resolve) => setImmediate(resolve))

    expect(electronMock.showMessageBox).toHaveBeenCalledWith(expect.objectContaining({
      title: "同步服务不可用",
    }))
    expect(allowQuit).toBe(true)
    expect(electronMock.app.quit).toHaveBeenCalledTimes(1)
  })
})
