import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const electronMock = vi.hoisted(() => ({
  app: {
    setAsDefaultProtocolClient: vi.fn(),
    setAppUserModelId: vi.fn(),
    on: vi.fn(),
    exit: vi.fn(),
  },
}))

const loggerMock = vi.hoisted(() => ({
  error: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
}))

vi.mock("electron", () => ({
  app: electronMock.app,
}))

vi.mock("../../services/log-store", () => ({
  createMainLogger: () => loggerMock,
}))

import {
  attachActivateHandler,
  attachOpenUrlHandler,
  attachProcessLevelLogging,
  attachSecondInstanceFocus,
  attachSecondInstanceProtocolHandler,
  registerAuthProtocol,
} from "../app-events"

describe("app event bootstrap", () => {
  const originalArgv = process.argv
  const originalDefaultApp = process.defaultApp

  beforeEach(() => {
    vi.clearAllMocks()
    Object.defineProperty(process, "argv", {
      configurable: true,
      value: ["/Electron", "/repo/desktop"],
    })
  })

  afterEach(() => {
    Object.defineProperty(process, "argv", {
      configurable: true,
      value: originalArgv,
    })
    Object.defineProperty(process, "defaultApp", {
      configurable: true,
      value: originalDefaultApp,
    })
  })

  it("warns when dev auth protocol registration fails", () => {
    Object.defineProperty(process, "defaultApp", {
      configurable: true,
      value: true,
    })
    electronMock.app.setAsDefaultProtocolClient.mockReturnValue(false)

    registerAuthProtocol()

    expect(electronMock.app.setAsDefaultProtocolClient).toHaveBeenCalledWith(
      "synapse",
      process.execPath,
      ["/repo/desktop"],
    )
    expect(loggerMock.warn).toHaveBeenCalledWith("Failed to register synapse:// protocol handler.", {
      defaultApp: true,
      hasDevEntrypoint: true,
      hint: "scripts/manual/fix-dev-protocol.sh",
    })
  })

  it("runs fatal cleanup before exiting on uncaught exceptions", async () => {
    const cleanup = vi.fn(async () => {})
    const onSpy = vi.spyOn(process, "on").mockImplementation(() => process)

    attachProcessLevelLogging({ cleanupBeforeExit: cleanup })
    const handler = onSpy.mock.calls.find(([event]) => event === "uncaughtException")?.[1] as (
      error: Error,
    ) => void

    handler(new Error("boom"))
    await vi.waitFor(() => {
      expect(electronMock.app.exit).toHaveBeenCalledWith(1)
    })

    expect(cleanup).toHaveBeenCalledTimes(1)
    onSpy.mockRestore()
  })

  it("exits after the fatal cleanup timeout", async () => {
    vi.useFakeTimers()
    const cleanup = vi.fn(() => new Promise<void>(() => {}))
    const onSpy = vi.spyOn(process, "on").mockImplementation(() => process)

    attachProcessLevelLogging({
      cleanupBeforeExit: cleanup,
      cleanupTimeoutMs: 10,
    })
    const handler = onSpy.mock.calls.find(([event]) => event === "unhandledRejection")?.[1] as (
      reason: unknown,
    ) => void

    handler(new Error("boom"))
    await vi.advanceTimersByTimeAsync(10)

    expect(cleanup).toHaveBeenCalledTimes(1)
    expect(electronMock.app.exit).toHaveBeenCalledWith(1)
    onSpy.mockRestore()
    vi.useRealTimers()
  })

  it("focuses the main window for a generic second-instance launch", () => {
    const window = {
      focus: vi.fn(),
      isMinimized: vi.fn(() => false),
      isVisible: vi.fn(() => true),
      restore: vi.fn(),
      show: vi.fn(),
    }

    attachSecondInstanceFocus({ current: window as never }, () => true)
    const handler = electronMock.app.on.mock.calls.find(([event]) => event === "second-instance")?.[1]
    handler?.({}, ["/Electron"])

    expect(window.focus).toHaveBeenCalledTimes(1)
  })

  it("does not focus the main window when the second-instance launch is routed elsewhere", () => {
    const window = {
      focus: vi.fn(),
      isMinimized: vi.fn(() => false),
      isVisible: vi.fn(() => true),
      restore: vi.fn(),
      show: vi.fn(),
    }

    attachSecondInstanceFocus({ current: window as never }, () => false)
    const handler = electronMock.app.on.mock.calls.find(([event]) => event === "second-instance")?.[1]
    handler?.({}, ["/Electron", "synapse://skill-install?session=session-1"])

    expect(window.focus).not.toHaveBeenCalled()
  })

  it("routes every protocol URL from a second-instance launch", () => {
    const handleUrl = vi.fn()

    attachSecondInstanceProtocolHandler(handleUrl)
    const handler = electronMock.app.on.mock.calls.find(([event]) => event === "second-instance")?.[1]
    handler?.({}, [
      "/Electron",
      "synapse://auth/desktop/callback?code=auth-code",
      "synapse://skill-install?session=session-1",
      "synapse://update?token=credential",
    ])

    expect(handleUrl).toHaveBeenNthCalledWith(1, "synapse://auth/desktop/callback?code=auth-code")
    expect(handleUrl).toHaveBeenNthCalledWith(2, "synapse://skill-install?session=session-1")
    expect(handleUrl).toHaveBeenNthCalledWith(3, "synapse://update?token=credential")
  })

  it("routes macOS open-url update launches through the shared protocol callback", () => {
    const handleUrl = vi.fn()
    const preventDefault = vi.fn()

    attachOpenUrlHandler(handleUrl)
    const handler = electronMock.app.on.mock.calls.find(([event]) => event === "open-url")?.[1]
    handler?.({ preventDefault }, "synapse://update")

    expect(preventDefault).toHaveBeenCalledTimes(1)
    expect(handleUrl).toHaveBeenCalledWith("synapse://update")
  })

  it("routes protocol URLs with case-insensitive schemes from a second-instance launch", () => {
    const handleUrl = vi.fn()

    attachSecondInstanceProtocolHandler(handleUrl)
    const handler = electronMock.app.on.mock.calls.find(([event]) => event === "second-instance")?.[1]
    handler?.({}, [
      "/Electron",
      "Synapse://auth/desktop/callback?code=auth-code",
      "SYNAPSE://skill-install?session=session-1",
    ])

    expect(handleUrl).toHaveBeenNthCalledWith(1, "Synapse://auth/desktop/callback?code=auth-code")
    expect(handleUrl).toHaveBeenNthCalledWith(2, "SYNAPSE://skill-install?session=session-1")
  })

  it("runs the show-or-create callback when the app is activated", () => {
    const showOrCreate = vi.fn()

    attachActivateHandler(showOrCreate)
    const handler = electronMock.app.on.mock.calls.find(([event]) => event === "activate")?.[1]
    handler?.()

    expect(showOrCreate).toHaveBeenCalledTimes(1)
  })
})
