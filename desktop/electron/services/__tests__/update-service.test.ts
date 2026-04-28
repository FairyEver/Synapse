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
    autoUpdater: new MockAutoUpdater(),
    MockCancellationToken,
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
    emit: vi.fn(),
  },
  Notification: class {
    static isSupported() {
      return false
    }
    on() {}
    show() {}
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

  it("does not handle a stale auto-check result as a manual update", async () => {
    vi.useFakeTimers()
    const { updateService } = await importUpdateService()
    const staleAutoCheckResolvers: Array<() => void> = []

    updaterMock.autoUpdater.checkForUpdates
      .mockImplementationOnce(() => new Promise((resolve) => {
        staleAutoCheckResolvers.push(() => {
          updaterMock.autoUpdater.emit("update-available", {
            version: "0.2.50",
            files: [{ url: "Synapse-0.2.50-mac-arm64.zip" }],
          })
          resolve({
            isUpdateAvailable: true,
            updateInfo: { version: "0.2.50" },
            versionInfo: { version: "0.2.50" },
          })
        })
      }))
      .mockImplementationOnce(async () => {
        updaterMock.autoUpdater.emit("checking-for-update")
        updaterMock.autoUpdater.emit("update-not-available", { version: "0.2.28" })
        return {
          isUpdateAvailable: false,
          updateInfo: { version: "0.2.28" },
          versionInfo: { version: "0.2.28" },
        }
      })

    updateService.startAutoCheck()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(staleAutoCheckResolvers.length).toBeGreaterThan(0)

    const manualState = await updateService.checkForUpdates()
    expect(manualState.status).toBe("not-available")

    staleAutoCheckResolvers[0]?.()
    await Promise.resolve()

    expect(updaterMock.autoUpdater.downloadUpdate).not.toHaveBeenCalled()
    expect(updateService.getState().status).toBe("not-available")
  })
})
