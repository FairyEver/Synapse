import { afterEach, describe, expect, it, vi } from "vitest"

const electronMock = vi.hoisted(() => ({
  focusedWindow: {
    webContents: { id: 1 },
    getBounds: vi.fn(() => ({ x: 100, y: 50, width: 800, height: 600 })),
    hide: vi.fn(),
    show: vi.fn(),
    isDestroyed: vi.fn(() => false),
    isVisible: vi.fn(() => true),
  },
  senderWindow: {
    webContents: { id: 42 },
    getBounds: vi.fn(() => ({ x: 20, y: 30, width: 400, height: 200 })),
    hide: vi.fn(),
    show: vi.fn(),
    isDestroyed: vi.fn(() => false),
    isVisible: vi.fn(() => true),
  },
  BrowserWindow: {
    getFocusedWindow: vi.fn(),
    getAllWindows: vi.fn(),
  },
}))

vi.mock("electron", () => ({
  BrowserWindow: electronMock.BrowserWindow,
}))

describe("runWithScreenshotWindowState", () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it("uses the sender window when a sender webContents id is provided", async () => {
    electronMock.BrowserWindow.getFocusedWindow.mockReturnValue(electronMock.focusedWindow)
    electronMock.BrowserWindow.getAllWindows.mockReturnValue([
      electronMock.focusedWindow,
      electronMock.senderWindow,
    ])
    const { runWithScreenshotWindowState } = await import("../window-capture")
    const operation = vi.fn(async () => "ok")

    await expect(runWithScreenshotWindowState({
      hideCurrentWindow: true,
      senderWebContentsId: 42,
    }, operation)).resolves.toBe("ok")

    expect(electronMock.senderWindow.hide).toHaveBeenCalledTimes(1)
    expect(electronMock.focusedWindow.hide).not.toHaveBeenCalled()
    expect(operation).toHaveBeenCalledWith({ targetPoint: { x: 220, y: 130 } })
    expect(electronMock.senderWindow.show).toHaveBeenCalledTimes(1)
  })

  it("passes the focused window center as target point and restores after hiding", async () => {
    electronMock.BrowserWindow.getFocusedWindow.mockReturnValue(electronMock.focusedWindow)
    electronMock.BrowserWindow.getAllWindows.mockReturnValue([])
    const { runWithScreenshotWindowState } = await import("../window-capture")
    const operation = vi.fn(async () => "ok")

    await expect(runWithScreenshotWindowState({ hideCurrentWindow: true }, operation)).resolves.toBe("ok")

    expect(electronMock.focusedWindow.hide).toHaveBeenCalledTimes(1)
    expect(operation).toHaveBeenCalledWith({ targetPoint: { x: 500, y: 350 } })
    expect(electronMock.focusedWindow.show).toHaveBeenCalledTimes(1)
  })

  it("restores the hidden window when the operation fails", async () => {
    electronMock.BrowserWindow.getFocusedWindow.mockReturnValue(electronMock.focusedWindow)
    electronMock.BrowserWindow.getAllWindows.mockReturnValue([])
    const { runWithScreenshotWindowState } = await import("../window-capture")

    await expect(runWithScreenshotWindowState({ hideCurrentWindow: true }, async () => {
      throw new Error("capture failed")
    })).rejects.toThrow("capture failed")

    expect(electronMock.focusedWindow.hide).toHaveBeenCalledTimes(1)
    expect(electronMock.focusedWindow.show).toHaveBeenCalledTimes(1)
  })

  it("does not hide when requested false but still provides the current target point", async () => {
    electronMock.BrowserWindow.getFocusedWindow.mockReturnValue(electronMock.focusedWindow)
    electronMock.BrowserWindow.getAllWindows.mockReturnValue([])
    const { runWithScreenshotWindowState } = await import("../window-capture")
    const operation = vi.fn(async () => "ok")

    await runWithScreenshotWindowState({ hideCurrentWindow: false }, operation)

    expect(electronMock.focusedWindow.hide).not.toHaveBeenCalled()
    expect(operation).toHaveBeenCalledWith({ targetPoint: { x: 500, y: 350 } })
  })
})
