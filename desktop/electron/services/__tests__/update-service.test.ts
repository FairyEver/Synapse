import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const updaterMock = vi.hoisted(() => {
  class MockCancellationToken {
    cancelled = false

    cancel(): void {
      this.cancelled = true
    }
  }

  class MockAutoUpdater {
    autoDownload = false
    autoInstallOnAppQuit = false
    logger: unknown = null
    private listeners = new Map<string, Set<(...args: unknown[]) => void>>()
    downloadUpdate = vi.fn(() => new Promise<string[]>(() => {}))
    checkForUpdates = vi.fn(async () => {
      this.emit("checking-for-update")
      this.emit("update-available", {
        version: "0.2.32",
        files: [{ url: "Synapse-0.2.32-mac-arm64.zip" }],
      })
      return {
        isUpdateAvailable: true,
        updateInfo: { version: "0.2.32" },
        versionInfo: { version: "0.2.32" },
      }
    })
    quitAndInstall = vi.fn()

    on(eventName: string, listener: (...args: unknown[]) => void): this {
      const listeners = this.listeners.get(eventName) ?? new Set()
      listeners.add(listener)
      this.listeners.set(eventName, listeners)
      return this
    }

    emit(eventName: string, ...args: unknown[]): boolean {
      const listeners = this.listeners.get(eventName)
      if (!listeners) {
        return false
      }

      for (const listener of listeners) {
        listener(...args)
      }

      return listeners.size > 0
    }

    removeAllListeners(): this {
      this.listeners.clear()
      return this
    }
  }

  return {
    appEmit: vi.fn(),
    autoUpdater: new MockAutoUpdater(),
    MockCancellationToken,
    notificationInstances: [] as Array<{
      readonly click: () => void
      readonly show: ReturnType<typeof vi.fn>
    }>,
    notificationSupported: false,
  }
})

vi.mock("electron-updater", () => ({
  autoUpdater: updaterMock.autoUpdater,
  CancellationToken: updaterMock.MockCancellationToken,
}))

vi.mock("electron", () => ({
  app: {
    getVersion: () => "0.2.28",
    isPackaged: true,
    emit: updaterMock.appEmit,
  },
  Notification: class {
    private readonly listeners = new Map<string, () => void>()
    readonly show = vi.fn()

    constructor() {
      updaterMock.notificationInstances.push({
        click: () => this.listeners.get("click")?.(),
        show: this.show,
      })
    }

    static isSupported() {
      return updaterMock.notificationSupported
    }

    on(eventName: string, listener: () => void) {
      this.listeners.set(eventName, listener)
    }
  },
}))

vi.mock("../log-store", () => ({
  createMainLogger: () => ({
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  }),
}))

vi.mock("../../ipc/validated-ipc", () => ({
  isTrustedRendererContents: (webContents: { getURL: () => string }) =>
    webContents.getURL() === "app://trusted",
}))

const platformDescriptor = Object.getOwnPropertyDescriptor(process, "platform")

async function importUpdateService() {
  return await import("../update-service")
}

describe("UpdateService", () => {
  beforeEach(() => {
    vi.resetModules()
    updaterMock.autoUpdater.removeAllListeners()
    updaterMock.autoUpdater.downloadUpdate.mockClear()
    updaterMock.autoUpdater.checkForUpdates.mockClear()
    updaterMock.autoUpdater.quitAndInstall.mockClear()
    updaterMock.appEmit.mockClear()
    updaterMock.notificationInstances.length = 0
    updaterMock.notificationSupported = false
    Object.defineProperty(process, "platform", {
      configurable: true,
      value: "darwin",
    })
  })

  afterEach(() => {
    vi.useRealTimers()
    if (platformDescriptor) {
      Object.defineProperty(process, "platform", platformDescriptor)
    }
  })

  it("enters downloading state as soon as manual download starts", async () => {
    const { updateService } = await importUpdateService()

    const state = await updateService.checkForUpdates()

    expect(updaterMock.autoUpdater.downloadUpdate).toHaveBeenCalledTimes(1)
    expect(state.status).toBe("downloading")
    expect(state.downloadPercent).toBe(0)
    expect(state.message).toBe("正在下载更新...")
  })

  it("keeps stale cancellation events from clearing a new manual update flow", async () => {
    const { updateService } = await importUpdateService()

    await updateService.checkForUpdates()
    await updateService.cancelDownload()

    updaterMock.autoUpdater.checkForUpdates.mockImplementationOnce(async () => {
      updaterMock.autoUpdater.emit("checking-for-update")
      updaterMock.autoUpdater.emit("update-available", {
        version: "0.2.33",
        files: [{ url: "Synapse-0.2.33-mac-arm64.zip" }],
      })
      return {
        isUpdateAvailable: true,
        updateInfo: { version: "0.2.33" },
        versionInfo: { version: "0.2.33" },
      }
    })

    const retryState = await updateService.checkForUpdates()
    expect(retryState).toEqual(expect.objectContaining({
      releaseVersion: "0.2.33",
      status: "downloading",
    }))

    updaterMock.autoUpdater.emit("update-cancelled", {
      version: "0.2.32",
      files: [{ url: "Synapse-0.2.32-mac-arm64.zip" }],
    })
    updaterMock.autoUpdater.emit("error", new Error("cancelled"))

    expect(updateService.getState()).toEqual(expect.objectContaining({
      releaseVersion: "0.2.33",
      status: "downloading",
    }))
    expect(updaterMock.autoUpdater.downloadUpdate).toHaveBeenCalledTimes(2)
  })

  it("broadcasts manual update state changes to managed windows", async () => {
    const { updateService } = await importUpdateService()
    const sent: Array<{ channel: string; payload: unknown }> = []

    updateService.setWindowManager({
      attach: vi.fn(),
      broadcast: vi.fn((channel, payload, filter) => {
        const window = {
          id: 1,
          role: "main" as const,
          isDestroyed: () => false,
          isVisible: () => true,
          isMinimized: () => false,
          show: vi.fn(),
          focus: vi.fn(),
          restore: vi.fn(),
          send: (nextChannel: string, nextPayload: unknown) => {
            sent.push({ channel: nextChannel, payload: nextPayload })
          },
          close: vi.fn(),
        }

        if (filter && !filter(window)) {
          return 0
        }

        window.send(channel, payload)
        return 1
      }),
      close: vi.fn(),
      detach: vi.fn(),
      getAllWindows: vi.fn(() => []),
      list: vi.fn(() => []),
      open: vi.fn(),
      register: vi.fn(),
    })

    await updateService.checkForUpdates()

    expect(sent).toContainEqual({
      channel: "synapse:update:state-changed",
      payload: expect.objectContaining({
        downloadPercent: 0,
        status: "downloading",
      }),
    })
  })

  it("does not start a manual update check while an automatic check is pending", async () => {
    vi.useFakeTimers()
    const { updateService } = await importUpdateService()
    let resolveAutoCheck: (() => void) | undefined

    updaterMock.autoUpdater.checkForUpdates
      .mockImplementationOnce(() => new Promise((resolve) => {
        resolveAutoCheck = () => {
          updaterMock.autoUpdater.emit("update-available", {
            version: "0.2.50",
            files: [{ url: "Synapse-0.2.50-mac-arm64.zip" }],
          })
          resolve({
            isUpdateAvailable: true,
            updateInfo: { version: "0.2.50" },
            versionInfo: { version: "0.2.50" },
          })
        }
      }))

    updateService.startAutoCheck()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(resolveAutoCheck).toBeTypeOf("function")

    const manualState = await updateService.checkForUpdates()
    expect(manualState.status).toBe("idle")
    expect(updaterMock.autoUpdater.checkForUpdates).toHaveBeenCalledTimes(1)

    resolveAutoCheck?.()
    await Promise.resolve()

    expect(updaterMock.autoUpdater.downloadUpdate).not.toHaveBeenCalled()
    expect(updateService.getState().status).toBe("idle")
  })

  it("keeps automatic update check failures out of visible update state", async () => {
    vi.useFakeTimers()
    const { updateService } = await importUpdateService()
    let rejectAutoCheck: ((error: Error) => void) | undefined

    expect(updateService.getState().status).toBe("idle")

    updaterMock.autoUpdater.checkForUpdates.mockImplementationOnce(() => new Promise((_resolve, reject) => {
      rejectAutoCheck = reject
    }))

    updateService.startAutoCheck()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(updaterMock.autoUpdater.checkForUpdates).toHaveBeenCalledTimes(1)
    expect(rejectAutoCheck).toBeTypeOf("function")

    rejectAutoCheck?.(new Error("Cannot find latest-mac.yml in the latest release artifacts"))
    await Promise.resolve()
    await Promise.resolve()

    expect(updateService.getState()).toEqual(expect.objectContaining({
      status: "idle",
      message: "可以检查新版本。",
      error: null,
      canCheck: true,
    }))
  })

  it("opens a main window before broadcasting the update page from notification clicks with no live windows", async () => {
    vi.useFakeTimers()
    updaterMock.notificationSupported = true
    const { updateService } = await importUpdateService()
    const calls: string[] = []
    const windowManager = {
      attach: vi.fn(),
      broadcast: vi.fn((channel: string) => {
        calls.push(`broadcast:${channel}`)
        return 1
      }),
      close: vi.fn(),
      detach: vi.fn(),
      getAllWindows: vi.fn(() => []),
      list: vi.fn(() => []),
      open: vi.fn(() => {
        calls.push("open:main")
        return {
          id: 1,
          role: "main" as const,
          isDestroyed: () => false,
          isVisible: () => true,
          isMinimized: () => false,
          show: vi.fn(),
          focus: vi.fn(),
          restore: vi.fn(),
          send: vi.fn(),
          close: vi.fn(),
        }
      }),
      register: vi.fn(),
    }

    updateService.setWindowManager(windowManager)
    updateService.initialize()
    updateService.startAutoCheck()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(updaterMock.notificationInstances).toHaveLength(1)

    updaterMock.notificationInstances[0]?.click()

    expect(windowManager.open).toHaveBeenCalledWith("main")
    expect(windowManager.broadcast).toHaveBeenCalledWith(
      "synapse:update:open-update-page",
      {},
    )
    expect(calls).toEqual([
      "open:main",
      "broadcast:synapse:update:open-update-page",
    ])
  })

  it("sanitizes manual update errors before exposing renderer state", async () => {
    const { updateService } = await importUpdateService()

    updaterMock.autoUpdater.checkForUpdates.mockRejectedValueOnce(
      new Error("Cannot find latest-mac.yml in the latest release artifacts at /Applications/Synapse.app Headers: { token: secret }"),
    )

    const state = await updateService.checkForUpdates()

    expect(state).toEqual(expect.objectContaining({
      status: "error",
      message: "检查更新失败，请稍后再试。",
      error: "检查更新失败，请稍后再试。",
      canCheck: true,
    }))
    expect(state.message).not.toContain("latest-mac.yml")
    expect(state.error).not.toContain("/Applications/Synapse.app")
  })

  it("prepares app quit before installing a downloaded update", async () => {
    const { updateService } = await importUpdateService()
    const beforeInstallQuit = vi.fn()

    await updateService.checkForUpdates()
    updaterMock.autoUpdater.emit("update-downloaded", {
      version: "0.2.32",
      downloadedFile: "/tmp/Synapse-0.2.32-mac-arm64.zip",
    })

    updateService.setBeforeInstallQuitHandler(beforeInstallQuit)
    await updateService.installUpdate()

    expect(beforeInstallQuit).toHaveBeenCalledTimes(1)
    expect(updaterMock.autoUpdater.quitAndInstall).toHaveBeenCalledTimes(1)
  })
})
