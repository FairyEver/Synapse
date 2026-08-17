import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { DESKTOP_UPDATE_INTENT_VERIFY_TIMEOUT_MS } from "../../../config"

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
        files: [
          { url: "v0.2.32/Synapse-0.2.32-mac-arm64.zip" },
          { url: "v0.2.32/Synapse-0.2.32-mac-arm64.dmg" },
        ],
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

    once(eventName: string, listener: (...args: unknown[]) => void): this {
      const wrapped = (...args: unknown[]) => {
        this.removeListener(eventName, wrapped)
        listener(...args)
      }
      return this.on(eventName, wrapped)
    }

    removeListener(eventName: string, listener: (...args: unknown[]) => void): this {
      this.listeners.get(eventName)?.delete(listener)
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
    appQuit: vi.fn(),
    autoUpdater: new MockAutoUpdater(),
    nativeAutoUpdater: new MockAutoUpdater(),
    MockCancellationToken,
    notificationInstances: [] as Array<{
      readonly click: () => void
      readonly show: ReturnType<typeof vi.fn>
    }>,
    notificationSupported: false,
  }
})

const loggerMock = vi.hoisted(() => ({
  debug: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
}))

vi.mock("electron-updater", () => ({
  autoUpdater: updaterMock.autoUpdater,
  CancellationToken: updaterMock.MockCancellationToken,
}))

vi.mock("electron", () => ({
  app: {
    getVersion: () => "0.2.28",
    isPackaged: true,
    emit: updaterMock.appEmit,
    quit: updaterMock.appQuit,
  },
  autoUpdater: updaterMock.nativeAutoUpdater,
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
  createMainLogger: () => loggerMock,
}))

vi.mock("../../generated/deployment-config.generated", () => ({
  SYNAPSE_DESKTOP_DEPLOYMENT_CONFIG: {
    apiBaseUrl: "https://desktop.example.test/api",
  },
}))

vi.mock("../../ipc/validated-ipc", () => ({
  isTrustedRendererContents: (webContents: { getURL: () => string }) =>
    webContents.getURL() === "app://trusted",
}))

const platformDescriptor = Object.getOwnPropertyDescriptor(process, "platform")

async function importUpdateService() {
  return await import("../update-service")
}

async function importUpdateServiceWithAllowedNetwork() {
  const { updateService } = await importUpdateService()
  updateService.setUpdateIntentVerificationSecurity({
    permissionGuard: {
      check: vi.fn(async () => ({ allowed: true as const, policyId: "test-policy" })),
      registerPolicy: vi.fn(),
    },
    auditSink: {
      clearForTests: vi.fn(),
      list: vi.fn(() => []),
      record: vi.fn(),
    },
  })
  return updateService
}

describe("UpdateService", () => {
  beforeEach(() => {
    vi.resetModules()
    updaterMock.autoUpdater.removeAllListeners()
    updaterMock.nativeAutoUpdater.removeAllListeners()
    updaterMock.autoUpdater.downloadUpdate.mockClear()
    updaterMock.autoUpdater.checkForUpdates.mockClear()
    updaterMock.autoUpdater.quitAndInstall.mockClear()
    updaterMock.appEmit.mockClear()
    updaterMock.appQuit.mockClear()
    updaterMock.notificationInstances.length = 0
    updaterMock.notificationSupported = false
    Object.defineProperty(process, "platform", {
      configurable: true,
      value: "darwin",
    })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    if (platformDescriptor) {
      Object.defineProperty(process, "platform", platformDescriptor)
    }
  })

  it("verifies update intents against the configured desktop API", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ authorized: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }))
    vi.stubGlobal("fetch", fetchMock)
    const updateService = await importUpdateServiceWithAllowedNetwork()

    await expect(updateService.verifyUpdateIntent("credential-canary")).resolves.toBe(true)

    expect(fetchMock).toHaveBeenCalledWith(
      "https://desktop.example.test/api/desktop/update-intent/verify",
      expect.objectContaining({
        body: JSON.stringify({ token: "credential-canary" }),
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
    )
  })

  it.each([
    ["non-success response", new Response("unauthorized", { status: 401 })],
    ["invalid authorization", new Response(JSON.stringify({ authorized: false }), { status: 200 })],
    ["unexpected response fields", new Response(JSON.stringify({ authorized: true, token: "leak" }), { status: 200 })],
    ["invalid JSON", new Response("not-json", { status: 200 })],
  ])("fails closed for a %s", async (_caseName, response) => {
    vi.stubGlobal("fetch", vi.fn(async () => response))
    const updateService = await importUpdateServiceWithAllowedNetwork()

    await expect(updateService.verifyUpdateIntent("credential-canary")).resolves.toBe(false)
  })

  it("fails closed on the real short verification timeout without logging the credential", async () => {
    const credential = "credential-timeout-canary"
    let requestSignal: AbortSignal | null = null
    const fetchMock = vi.fn((_url: string | URL | Request, init?: RequestInit) => {
      requestSignal = init?.signal ?? null
      return new Promise<Response>((_resolve, reject) => {
        requestSignal?.addEventListener("abort", () => {
          reject(new DOMException(`timed out ${credential}`, "TimeoutError"))
        }, { once: true })
      })
    })
    vi.stubGlobal("fetch", fetchMock)
    const updateService = await importUpdateServiceWithAllowedNetwork()

    const verification = updateService.verifyUpdateIntent(credential)
    expect(DESKTOP_UPDATE_INTENT_VERIFY_TIMEOUT_MS).toBe(3_000)
    await vi.waitFor(() => {
      expect(requestSignal).not.toBeNull()
    })
    const capturedSignal = requestSignal as AbortSignal | null
    capturedSignal?.dispatchEvent(new Event("abort"))

    await expect(verification).resolves.toBe(false)
    expect(loggerMock.warn).toHaveBeenCalledWith(
      "Update intent verification failed closed.",
      { outcome: "timeout" },
    )
    expect(JSON.stringify({
      error: loggerMock.error.mock.calls,
      info: loggerMock.info.mock.calls,
      warn: loggerMock.warn.mock.calls,
    })).not.toContain(credential)
  })

  it("fails closed before connecting when verification security is unavailable", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ authorized: true })))
    vi.stubGlobal("fetch", fetchMock)
    const { updateService } = await importUpdateService()

    await expect(updateService.verifyUpdateIntent("credential-canary")).resolves.toBe(false)

    expect(fetchMock).not.toHaveBeenCalled()
    expect(loggerMock.warn).toHaveBeenCalledWith(
      "Update intent verification failed closed.",
      { outcome: "security-unavailable" },
    )
  })

  it("fails closed before connecting when update intent verification permission is denied", async () => {
    const fetchMock = vi.fn()
    const permissionGuard = {
      check: vi.fn(async () => ({ allowed: false as const, reason: "denied", policyId: "test-policy" })),
      registerPolicy: vi.fn(),
    }
    const auditSink = {
      clearForTests: vi.fn(),
      list: vi.fn(() => []),
      record: vi.fn(),
    }
    vi.stubGlobal("fetch", fetchMock)
    const { updateService } = await importUpdateService()

    updateService.setUpdateIntentVerificationSecurity({ auditSink, permissionGuard })
    await expect(updateService.verifyUpdateIntent("credential-denied-canary")).resolves.toBe(false)

    expect(fetchMock).not.toHaveBeenCalled()
    expect(permissionGuard.check).toHaveBeenCalledWith({
      action: "network.connect",
      actor: { kind: "system", id: "desktop-update-intent" },
      context: { source: "desktop.update-intent.verify" },
      resource: "https://desktop.example.test/api/desktop/update-intent/verify",
    })
    expect(auditSink.record).toHaveBeenCalledWith(expect.objectContaining({
      action: "network.connect",
      outcome: "denied",
      resource: "https://desktop.example.test/api/desktop/update-intent/verify",
    }))
    expect(JSON.stringify(auditSink.record.mock.calls)).not.toContain("credential-denied-canary")
  })

  it("waits for explicit confirmation before downloading an available update", async () => {
    const { updateService } = await importUpdateService()

    const availableState = await updateService.checkForUpdates()

    expect(updaterMock.autoUpdater.downloadUpdate).not.toHaveBeenCalled()
    expect(availableState).toEqual(expect.objectContaining({
      releaseVersion: "0.2.32",
      status: "available",
    }))

    const downloadingState = updateService.downloadUpdate()

    expect(updaterMock.autoUpdater.downloadUpdate).toHaveBeenCalledTimes(1)
    expect(downloadingState.status).toBe("downloading")
    expect(downloadingState.downloadPercent).toBe(0)
    expect(downloadingState.message).toBe("正在下载更新...")
  })

  it("keeps stale cancellation events from clearing a new manual update flow", async () => {
    const { updateService } = await importUpdateService()

    await updateService.checkForUpdates()
    updateService.downloadUpdate()
    await updateService.cancelDownload()

    expect(updateService.getState()).toEqual(expect.objectContaining({
      releaseVersion: "0.2.32",
      status: "available",
    }))

    const retryState = updateService.downloadUpdate()
    expect(retryState).toEqual(expect.objectContaining({
      releaseVersion: "0.2.32",
      status: "downloading",
    }))

    updaterMock.autoUpdater.emit("update-cancelled", {
      version: "0.2.32",
      files: [{ url: "Synapse-0.2.32-mac-arm64.zip" }],
    })
    updaterMock.autoUpdater.emit("error", new Error("cancelled"))

    expect(updateService.getState()).toEqual(expect.objectContaining({
      releaseVersion: "0.2.32",
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
      channel: "synapse:app:update:operation:state_changed",
      payload: expect.objectContaining({
        releaseVersion: "0.2.32",
        status: "available",
      }),
    })
  })

  it("broadcasts update open requests while retaining the latest request for pull delivery", async () => {
    const { updateService } = await importUpdateService()
    const windowManager = {
      attach: vi.fn(),
      broadcast: vi.fn(() => 1),
      close: vi.fn(),
      detach: vi.fn(),
      getAllWindows: vi.fn(() => []),
      list: vi.fn(() => []),
      open: vi.fn(),
      register: vi.fn(),
    }
    updateService.setWindowManager(windowManager)

    const request = updateService.publishUpdateOpenRequest(true)

    expect(windowManager.broadcast).toHaveBeenCalledWith(
      "synapse:app:update:operation:open_request",
      request,
    )
    expect(updateService.getPendingOpenRequest()).toEqual(request)
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
    expect(updateService.getState()).toEqual(expect.objectContaining({
      releaseVersion: "0.2.50",
      status: "available",
    }))
  })

  it("deduplicates page-entry checks and applies a 30-second cooldown", async () => {
    vi.useFakeTimers()
    const { updateService } = await importUpdateService()
    const noUpdateCheck = async () => {
      updaterMock.autoUpdater.emit("checking-for-update")
      updaterMock.autoUpdater.emit("update-not-available", { version: "0.2.28" })
      return {
        isUpdateAvailable: false,
        updateInfo: { version: "0.2.28" },
        versionInfo: { version: "0.2.28" },
      }
    }
    updaterMock.autoUpdater.checkForUpdates
      .mockImplementationOnce(noUpdateCheck)
      .mockImplementationOnce(noUpdateCheck)

    await Promise.all([
      updateService.checkForUpdatesOnPageEnter(),
      updateService.checkForUpdatesOnPageEnter(),
    ])
    await updateService.checkForUpdatesOnPageEnter()

    expect(updaterMock.autoUpdater.checkForUpdates).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(30_000)
    await updateService.checkForUpdatesOnPageEnter()

    expect(updaterMock.autoUpdater.checkForUpdates).toHaveBeenCalledTimes(2)
  })

  it("keeps an available update ready to retry after download failure", async () => {
    const { updateService } = await importUpdateService()
    updaterMock.autoUpdater.downloadUpdate.mockRejectedValueOnce(new Error("network failed"))

    await updateService.checkForUpdates()
    updateService.downloadUpdate()
    await Promise.resolve()
    await Promise.resolve()

    expect(updateService.getState()).toEqual(expect.objectContaining({
      error: "下载更新失败，请重试。",
      releaseVersion: "0.2.32",
      status: "available",
    }))
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

  it("does not poll update metadata every minute after the startup auto check", async () => {
    vi.useFakeTimers()
    const { updateService } = await importUpdateService()
    updateService.initialize()
    const noUpdateCheck = async () => {
      updaterMock.autoUpdater.emit("checking-for-update")
      updaterMock.autoUpdater.emit("update-not-available", { version: "0.2.32" })
      return {
        isUpdateAvailable: false,
        updateInfo: { version: "0.2.32" },
        versionInfo: { version: "0.2.32" },
      }
    }
    updaterMock.autoUpdater.checkForUpdates
      .mockImplementationOnce(noUpdateCheck)
      .mockImplementationOnce(noUpdateCheck)

    updateService.startAutoCheck()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(updaterMock.autoUpdater.checkForUpdates).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(60_000)
    expect(updaterMock.autoUpdater.checkForUpdates).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(6 * 60 * 60 * 1000 - 60_000)
    expect(updaterMock.autoUpdater.checkForUpdates).toHaveBeenCalledTimes(2)
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
      "synapse:app:update:operation:open_update_page",
      {},
    )
    expect(calls).toEqual([
      "broadcast:synapse:app:update:operation:state_changed",
      "open:main",
      "broadcast:synapse:app:update:operation:open_update_page",
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
    const canQuit = vi.fn(() => true)
    const allowQuit = vi.fn()
    const installRecovery = {
      ensureShipItStarted: vi.fn(async () => true),
      markManualRequired: vi.fn(async () => ({ kind: "none" as const })),
      reconcile: vi.fn(async () => ({ kind: "none" as const })),
      recordInstallAttempt: vi.fn(async () => ({ schemaVersion: 1 as const, pendingAttempt: null })),
      restoreState: vi.fn(async () => undefined),
      updatePreparedTarget: vi.fn(async () => undefined),
    }

    await updateService.checkForUpdates()
    updateService.downloadUpdate()
    updaterMock.autoUpdater.emit("update-downloaded", {
      version: "0.2.32",
      downloadedFile: "/tmp/Synapse-0.2.32-mac-arm64.zip",
    })

    updateService.setInstallQuitHandlers({ allowQuit, canQuit })
    updateService.setInstallRecoveryService(installRecovery)
    const installing = updateService.installUpdate()

    expect(canQuit).toHaveBeenCalledTimes(1)
    expect(allowQuit).not.toHaveBeenCalled()
    expect(installRecovery.recordInstallAttempt).toHaveBeenCalledWith(
      "0.2.32",
      "https://desktop.release.synapse.d2.pub/v0.2.32/Synapse-0.2.32-mac-arm64.dmg",
    )
    await vi.waitFor(() => {
      expect(updaterMock.autoUpdater.quitAndInstall).toHaveBeenCalledWith(false, true)
    })

    updaterMock.nativeAutoUpdater.emit("before-quit-for-update")
    await installing

    expect(allowQuit).toHaveBeenCalledTimes(1)
    expect(installRecovery.ensureShipItStarted).toHaveBeenCalledTimes(1)
    expect(updaterMock.appQuit).toHaveBeenCalledTimes(1)
    expect(loggerMock.info).toHaveBeenCalledWith(
      "macOS native updater requested app quit.",
      expect.objectContaining({ targetVersion: "0.2.32" }),
    )
  })

  it("records when the native macOS updater finishes staging", async () => {
    const { updateService } = await importUpdateService()
    await updateService.checkForUpdates()

    updaterMock.nativeAutoUpdater.emit("update-downloaded")

    expect(loggerMock.info).toHaveBeenCalledWith(
      "macOS native updater finished staging the update.",
      expect.objectContaining({
        currentVersion: "0.2.28",
        targetVersion: "0.2.32",
      }),
    )
  })

  it("keeps the app open when ShipIt is registered but never starts", async () => {
    const { updateService } = await importUpdateService()
    const previousState = { schemaVersion: 1 as const, pendingAttempt: null }
    const allowQuit = vi.fn()
    const installRecovery = {
      ensureShipItStarted: vi.fn(async () => false),
      markManualRequired: vi.fn(async () => ({ kind: "none" as const })),
      reconcile: vi.fn(async () => ({ kind: "none" as const })),
      recordInstallAttempt: vi.fn(async () => previousState),
      restoreState: vi.fn(async () => undefined),
      updatePreparedTarget: vi.fn(async () => undefined),
    }

    await updateService.checkForUpdates()
    updateService.downloadUpdate()
    updaterMock.autoUpdater.emit("update-downloaded", {
      version: "0.2.32",
      downloadedFile: "/tmp/Synapse-0.2.32-mac-arm64.zip",
    })
    updateService.setInstallQuitHandlers({ allowQuit, canQuit: () => true })
    updateService.setInstallRecoveryService(installRecovery)

    const installing = updateService.installUpdate()
    await vi.waitFor(() => {
      expect(updaterMock.autoUpdater.quitAndInstall).toHaveBeenCalledTimes(1)
    })
    updaterMock.nativeAutoUpdater.emit("before-quit-for-update")

    await expect(installing).rejects.toThrow("无法启动更新安装程序，请重新打开 Synapse 后重试。")
    expect(installRecovery.restoreState).toHaveBeenCalledWith(previousState)
    expect(allowQuit).not.toHaveBeenCalled()
    expect(updaterMock.appQuit).not.toHaveBeenCalled()
    expect(updateService.getState()).toEqual(expect.objectContaining({
      error: "无法启动更新安装程序，请重新打开 Synapse 后重试。",
      status: "downloaded",
    }))
  })

  it("hard-times out ShipIt startup verification and aborts the probe", async () => {
    vi.useFakeTimers()
    const { updateService } = await importUpdateService()
    const previousState = { schemaVersion: 1 as const, pendingAttempt: null }
    let probeSignal: AbortSignal | undefined
    const installRecovery = {
      ensureShipItStarted: vi.fn((signal?: AbortSignal) => {
        probeSignal = signal
        return new Promise<boolean>(() => {})
      }),
      markManualRequired: vi.fn(async () => ({ kind: "none" as const })),
      reconcile: vi.fn(async () => ({ kind: "none" as const })),
      recordInstallAttempt: vi.fn(async () => previousState),
      restoreState: vi.fn(async () => undefined),
      updatePreparedTarget: vi.fn(async () => undefined),
    }

    await updateService.checkForUpdates()
    updateService.downloadUpdate()
    updaterMock.autoUpdater.emit("update-downloaded", {
      version: "0.2.32",
      downloadedFile: "/tmp/Synapse-0.2.32-mac-arm64.zip",
    })
    updateService.setInstallQuitHandlers({ allowQuit: vi.fn(), canQuit: () => true })
    updateService.setInstallRecoveryService(installRecovery)

    const installing = updateService.installUpdate()
    await vi.advanceTimersByTimeAsync(0)
    updaterMock.nativeAutoUpdater.emit("before-quit-for-update")
    const rejection = expect(installing).rejects.toThrow(
      "无法启动更新安装程序，请重新打开 Synapse 后重试。",
    )
    await vi.advanceTimersByTimeAsync(10_000)

    await rejection
    expect(probeSignal?.aborted).toBe(true)
    expect(installRecovery.restoreState).toHaveBeenCalledWith(previousState)
    expect(updaterMock.appQuit).not.toHaveBeenCalled()
  })

  it("does not install a downloaded update when app quit is blocked", async () => {
    const { updateService } = await importUpdateService()
    const beforeInstallQuit = vi.fn(() => false)

    await updateService.checkForUpdates()
    updateService.downloadUpdate()
    updaterMock.autoUpdater.emit("update-downloaded", {
      version: "0.2.32",
      downloadedFile: "/tmp/Synapse-0.2.32-mac-arm64.zip",
    })

    updateService.setInstallQuitHandlers({
      allowQuit: vi.fn(),
      canQuit: beforeInstallQuit,
    })
    await expect(updateService.installUpdate()).rejects.toThrow("当前无法安全退出应用，请稍后再安装更新。")

    expect(beforeInstallQuit).toHaveBeenCalledTimes(1)
    expect(updaterMock.autoUpdater.quitAndInstall).not.toHaveBeenCalled()
  })

  it("rolls back the persisted install attempt when native macOS handoff times out", async () => {
    vi.useFakeTimers()
    const { updateService } = await importUpdateService()
    const previousState = { schemaVersion: 1 as const, pendingAttempt: null }
    const installRecovery = {
      ensureShipItStarted: vi.fn(async () => true),
      markManualRequired: vi.fn(async () => ({ kind: "none" as const })),
      reconcile: vi.fn(async () => ({ kind: "none" as const })),
      recordInstallAttempt: vi.fn(async () => previousState),
      restoreState: vi.fn(async () => undefined),
      updatePreparedTarget: vi.fn(async () => undefined),
    }

    await updateService.checkForUpdates()
    updateService.downloadUpdate()
    updaterMock.autoUpdater.emit("update-downloaded", {
      version: "0.2.32",
      downloadedFile: "/tmp/Synapse-0.2.32-mac-arm64.zip",
    })
    updateService.setInstallQuitHandlers({ allowQuit: vi.fn(), canQuit: () => true })
    updateService.setInstallRecoveryService(installRecovery)

    const installing = updateService.installUpdate()
    const rejection = expect(installing).rejects.toThrow("无法启动更新安装程序，请重新打开 Synapse 后重试。")
    await vi.advanceTimersByTimeAsync(120_000)
    await rejection

    expect(installRecovery.restoreState).toHaveBeenCalledWith(previousState)
    expect(updateService.getState()).toEqual(expect.objectContaining({
      error: "无法启动更新安装程序，请重新打开 Synapse 后重试。",
      status: "downloaded",
    }))
  })

  it("repairs and redownloads once without automatically installing", async () => {
    const { updateService } = await importUpdateService()
    const installRecovery = {
      ensureShipItStarted: vi.fn(async () => true),
      markManualRequired: vi.fn(),
      reconcile: vi.fn(async () => ({
        kind: "recover" as const,
        manualInstallerUrl: "https://desktop.release.synapse.d2.pub/v0.2.32/Synapse-0.2.32-mac-arm64.dmg",
        targetVersion: "0.2.32",
      })),
      recordInstallAttempt: vi.fn(async () => ({ schemaVersion: 1 as const, pendingAttempt: null })),
      restoreState: vi.fn(async () => undefined),
      updatePreparedTarget: vi.fn(async () => undefined),
    }
    updateService.setInstallRecoveryService(installRecovery)

    await updateService.initializeInstallRecovery()

    expect(updaterMock.autoUpdater.checkForUpdates).toHaveBeenCalledTimes(1)
    expect(updaterMock.autoUpdater.downloadUpdate).toHaveBeenCalledTimes(1)
    expect(updaterMock.autoUpdater.quitAndInstall).not.toHaveBeenCalled()
    updaterMock.autoUpdater.emit("update-downloaded", {
      version: "0.2.32",
      downloadedFile: "/tmp/Synapse-0.2.32-mac-arm64.zip",
    })
    expect(updateService.getState()).toEqual(expect.objectContaining({
      installRecovery: expect.objectContaining({ phase: "retry-ready" }),
      status: "downloaded",
    }))
  })
})
