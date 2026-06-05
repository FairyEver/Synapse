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

import { registerAuthProtocol } from "../app-events"

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
      hint: "scripts/fix-dev-protocol.sh",
    })
  })
})
