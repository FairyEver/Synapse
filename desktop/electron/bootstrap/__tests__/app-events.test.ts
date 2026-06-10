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
    handler?.({}, ["/Electron", "synapse://content-install?session=session-1"])

    expect(window.focus).not.toHaveBeenCalled()
  })

  it("routes every protocol URL from a second-instance launch", () => {
    const handleUrl = vi.fn()

    attachSecondInstanceProtocolHandler(handleUrl)
    const handler = electronMock.app.on.mock.calls.find(([event]) => event === "second-instance")?.[1]
    handler?.({}, [
      "/Electron",
      "synapse://auth/desktop/callback?code=auth-code",
      "synapse://content-install?session=session-1",
    ])

    expect(handleUrl).toHaveBeenNthCalledWith(1, "synapse://auth/desktop/callback?code=auth-code")
    expect(handleUrl).toHaveBeenNthCalledWith(2, "synapse://content-install?session=session-1")
  })
})
