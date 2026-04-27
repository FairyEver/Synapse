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
  isTrustedRendererContents: () => true,
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
})
