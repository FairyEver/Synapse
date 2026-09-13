import type { BrowserWindow } from "electron"
import { describe, expect, it, vi } from "vitest"

import { managedBrowserWindow } from "../electron-window"
import { createWindowManager } from "../manager"

function makeWindow(id = 1) {
  const frame = {
    isDestroyed: vi.fn(() => false),
    detached: false,
    send: vi.fn(),
  }
  const webContents = {
    id,
    isDestroyed: vi.fn(() => false),
    mainFrame: frame,
    send: vi.fn((channel: string, payload: unknown) => {
      webContents.mainFrame.send(channel, payload)
    }),
  }
  const window = { isDestroyed: vi.fn(() => false), webContents }
  return { window, webContents, frame, managed: managedBrowserWindow(window as unknown as BrowserWindow, "main") }
}

describe("managedBrowserWindow message delivery", () => {
  it("delivers the channel and payload to a live renderer", () => {
    const { managed, frame } = makeWindow()
    const payload = { revision: 2 }

    managed.send("synapse:test", payload)

    expect(frame.send).toHaveBeenCalledExactlyOnceWith("synapse:test", payload)
  })

  it.each(["window", "webContents", "frame"] as const)("skips a destroyed %s", (target) => {
    const fixture = makeWindow()
    fixture[target].isDestroyed.mockReturnValue(true)

    fixture.managed.send("synapse:test", {})

    expect(fixture.frame.send).not.toHaveBeenCalled()
  })

  it("skips a detached frame and resumes delivery to its replacement", () => {
    const { managed, webContents, frame } = makeWindow()
    frame.detached = true
    managed.send("synapse:test", { revision: 1 })
    expect(frame.send).not.toHaveBeenCalled()

    const replacement = makeWindow().frame
    webContents.mainFrame = replacement
    managed.send("synapse:test", { revision: 2 })

    expect(replacement.send).toHaveBeenCalledExactlyOnceWith("synapse:test", { revision: 2 })
  })

  it("keeps broadcasting to healthy windows while another renderer is disposed", () => {
    const disposed = makeWindow(1)
    const healthy = makeWindow(2)
    disposed.frame.isDestroyed.mockReturnValue(true)
    const manager = createWindowManager()
    manager.attach({ id: "main", role: "main" }, disposed.managed)
    manager.attach({ id: "detail", role: "detail" }, healthy.managed)

    manager.broadcast("synapse:test", { revision: 3 })

    expect(disposed.frame.send).not.toHaveBeenCalled()
    expect(healthy.frame.send).toHaveBeenCalledExactlyOnceWith("synapse:test", { revision: 3 })
  })
})
