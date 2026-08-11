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
    installQuitHandlers: null as {
      allowQuit: () => void
      canQuit: () => boolean | void
    } | null,
    cancelDownload: vi.fn(async () => {}),
    setInstallQuitHandlers: vi.fn(),
  }

  mock.setInstallQuitHandlers.mockImplementation((handlers: typeof mock.installQuitHandlers) => {
    mock.installQuitHandlers = handlers
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
    updateServiceMock.installQuitHandlers = null
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

    const canQuit = updateServiceMock.installQuitHandlers?.canQuit()

    expect(canQuit).toBe(true)
    expect(allowQuit).toBe(false)

    updateServiceMock.installQuitHandlers?.allowQuit()

    expect(allowQuit).toBe(true)
    expect(stopAll).not.toHaveBeenCalled()
    expect(logStoreMock.dispose).not.toHaveBeenCalled()
  })

  it("blocks update install quit while knowledge base storage migration is active", async () => {
    const { attachBeforeQuitHandler } = await import("../before-quit")
    const storageMigration = {
      isActive: vi.fn(() => true),
      focusDialog: vi.fn(),
    }
    let allowQuit = false

    attachBeforeQuitHandler({
      state: { current: null },
      registry: { stopAll: vi.fn(async () => {}) } as never,
      knowledgeBaseStorageMigration: storageMigration,
      setAllowQuit: (value) => {
        allowQuit = value
      },
      isAllowedToQuit: () => allowQuit,
    })

    const canQuit = updateServiceMock.installQuitHandlers?.canQuit()

    expect(canQuit).toBe(false)
    expect(allowQuit).toBe(false)
    expect(storageMigration.focusDialog).toHaveBeenCalled()
  })

  it("allows update install quit when failed knowledge base migration requires restart recovery", async () => {
    const { attachBeforeQuitHandler } = await import("../before-quit")
    const storageMigration = {
      isActive: vi.fn(() => true),
      requiresRestartForRecovery: vi.fn(() => true),
      focusDialog: vi.fn(),
    }
    let allowQuit = false

    attachBeforeQuitHandler({
      state: { current: null },
      registry: { stopAll: vi.fn(async () => {}) } as never,
      knowledgeBaseStorageMigration: storageMigration,
      setAllowQuit: (value) => {
        allowQuit = value
      },
      isAllowedToQuit: () => allowQuit,
    })

    const canQuit = updateServiceMock.installQuitHandlers?.canQuit()

    expect(canQuit).toBe(true)
    expect(allowQuit).toBe(false)
    expect(storageMigration.focusDialog).not.toHaveBeenCalled()
  })

  it("blocks before-quit while knowledge base storage migration is active", async () => {
    const { attachBeforeQuitHandler } = await import("../before-quit")
    const storageMigration = {
      isActive: vi.fn(() => true),
      focusDialog: vi.fn(),
    }
    let allowQuit = false
    const event = { preventDefault: vi.fn() }

    attachBeforeQuitHandler({
      state: { current: null },
      registry: { stopAll: vi.fn(async () => {}) } as never,
      knowledgeBaseStorageMigration: storageMigration,
      setAllowQuit: (value) => {
        allowQuit = value
      },
      isAllowedToQuit: () => allowQuit,
    })
    const beforeQuitHandler = electronMock.app.on.mock.calls.find(
      ([eventName]) => eventName === "before-quit",
    )?.[1] as (event: { preventDefault: () => void }) => Promise<void>

    await beforeQuitHandler(event)

    expect(event.preventDefault).toHaveBeenCalled()
    expect(storageMigration.focusDialog).toHaveBeenCalled()
    expect(electronMock.app.quit).not.toHaveBeenCalled()
  })

  it("allows before-quit to restart when failed knowledge base migration requires restart recovery", async () => {
    const { attachBeforeQuitHandler } = await import("../before-quit")
    const storageMigration = {
      isActive: vi.fn(() => true),
      requiresRestartForRecovery: vi.fn(() => true),
      focusDialog: vi.fn(),
    }
    let allowQuit = false
    const event = { preventDefault: vi.fn() }

    attachBeforeQuitHandler({
      state: { current: null },
      registry: { stopAll: vi.fn(async () => {}) } as never,
      knowledgeBaseStorageMigration: storageMigration,
      setAllowQuit: (value) => {
        allowQuit = value
      },
      isAllowedToQuit: () => allowQuit,
    })
    const beforeQuitHandler = electronMock.app.on.mock.calls.find(
      ([eventName]) => eventName === "before-quit",
    )?.[1] as (event: { preventDefault: () => void }) => Promise<void>

    await beforeQuitHandler(event)

    expect(event.preventDefault).toHaveBeenCalled()
    expect(allowQuit).toBe(true)
    expect(electronMock.app.quit).toHaveBeenCalled()
    expect(storageMigration.focusDialog).not.toHaveBeenCalled()
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

  it("starts all pending repository pushes before waiting for slow pushes during quit", async () => {
    const { configStore } = await import("../../services/config-store")
    const { attachBeforeQuitHandler } = await import("../before-quit")
    const repositories = [
      {
        uuid: "repo-1",
        name: "Repo 1",
        localPath: "/repo-1",
        contentDirs: {},
      },
      {
        uuid: "repo-2",
        name: "Repo 2",
        localPath: "/repo-2",
        contentDirs: {},
      },
    ]
    let resolveSlowPush: () => void = () => {}
    const slowPush = new Promise<void>((resolve) => {
      resolveSlowPush = resolve
    })
    const coordinator = {
      countAllPending: vi.fn(async () => 2),
      requestPush: vi.fn((repository: { uuid: string }) => {
        if (repository.uuid === "repo-1") {
          return slowPush
        }
        return Promise.resolve()
      }),
    }
    vi.mocked(configStore.load).mockResolvedValueOnce({
      activeRepoUuid: "repo-1",
      repositories,
      global: {},
    } as never)
    electronMock.showMessageBox.mockResolvedValueOnce({ response: 0 } as never)
    let allowQuit = false

    attachBeforeQuitHandler({
      state: { current: null },
      registry: {
        get: vi.fn((id: string) => {
          if (id === "repo.sync-coordinator") {
            return coordinator
          }
          throw new Error(`Unexpected service id: ${id}`)
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

    try {
      expect(coordinator.requestPush).toHaveBeenCalledTimes(2)
      expect(coordinator.requestPush).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({ uuid: "repo-1" }),
        "quit",
      )
      expect(coordinator.requestPush).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({ uuid: "repo-2" }),
        "quit",
      )
      expect(allowQuit).toBe(false)
    } finally {
      resolveSlowPush()
      await new Promise((resolve) => setImmediate(resolve))
    }

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

  it("does not force quit while the pending-push confirmation dialog is open", async () => {
    vi.useFakeTimers()
    const { attachBeforeQuitHandler } = await import("../before-quit")
    const coordinator = {
      countAllPending: vi.fn(async () => 1),
      requestPush: vi.fn(async () => undefined),
    }
    let resolveDialog: (value: { response: number }) => void = () => {}
    const dialogPromise = new Promise<{ response: number }>((resolve) => {
      resolveDialog = resolve
    })
    electronMock.showMessageBox.mockReturnValueOnce(dialogPromise as never)
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
    await vi.runAllTimersAsync()
    vi.advanceTimersByTime(15_000)
    await vi.runAllTimersAsync()

    expect(electronMock.showMessageBox).toHaveBeenCalled()
    expect(electronMock.app.quit).not.toHaveBeenCalled()
    expect(allowQuit).toBe(false)

    resolveDialog({ response: 1 })
    await vi.runAllTimersAsync()
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
