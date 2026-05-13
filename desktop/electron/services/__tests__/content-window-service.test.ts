import { describe, expect, it, vi } from "vitest"

import { createContentWindowService } from "../content-window-service"

describe("createContentWindowService", () => {
  it("attaches renderer health monitoring to content detail windows", async () => {
    const webContents = {
      on: vi.fn(),
      loadURL: vi.fn(),
    }
    const window = {
      webContents,
      once: vi.fn(),
      on: vi.fn(),
      show: vi.fn(),
    }
    const health = { attach: vi.fn(), detach: vi.fn() }
    const service = createContentWindowService({
      createWindow: vi.fn(() => window as never),
      createHealthService: vi.fn(() => health),
      getAppPath: () => "/app",
      getIconPath: () => null,
      getPreloadPath: () => "/preload.js",
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      loadWindow: vi.fn(async () => undefined),
    })

    await service.openDetailWindow({
      contentType: "rule",
      id: "rule-1",
      title: "Rule",
      viewMode: "rendered",
    })

    expect(health.attach).toHaveBeenCalledWith(webContents)

    const closedHandler = window.on.mock.calls.find(([event]) => event === "closed")?.[1]
    closedHandler?.()

    expect(health.detach).toHaveBeenCalled()
  })
})
