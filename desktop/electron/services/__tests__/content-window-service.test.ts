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
    const createWindow = vi.fn(() => window as never)
    const service = createContentWindowService({
      createWindow,
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

    expect(createWindow).toHaveBeenCalledWith(expect.objectContaining({
      width: 1280,
      height: 760,
      minWidth: 1120,
    }))
    expect(health.attach).toHaveBeenCalledWith(webContents)

    const closedHandler = window.on.mock.calls.find(([event]) => event === "closed")?.[1]
    closedHandler?.()

    expect(health.detach).toHaveBeenCalled()
  })

  it("focuses an existing detail window for the same content item instead of creating a duplicate", async () => {
    const webContents = {
      on: vi.fn(),
      loadURL: vi.fn(),
    }
    const window = {
      webContents,
      focus: vi.fn(),
      isDestroyed: vi.fn(() => false),
      isMinimized: vi.fn(() => false),
      once: vi.fn(),
      on: vi.fn(),
      show: vi.fn(),
    }
    const health = { attach: vi.fn(), detach: vi.fn() }
    const createWindow = vi.fn(() => window as never)
    const loadWindow = vi.fn(async () => undefined)
    const service = createContentWindowService({
      createWindow,
      createHealthService: vi.fn(() => health),
      getAppPath: () => "/app",
      getIconPath: () => null,
      getPreloadPath: () => "/preload.js",
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      loadWindow,
    })

    await service.openDetailWindow({
      contentType: "skill",
      id: "skill-1",
      title: "Skill",
      viewMode: "rendered",
    })
    await service.openDetailWindow({
      contentType: "skill",
      id: "skill-1",
      title: "Skill",
      viewMode: "source",
    })

    expect(createWindow).toHaveBeenCalledTimes(1)
    expect(loadWindow).toHaveBeenCalledTimes(1)
    expect(window.focus).toHaveBeenCalledTimes(1)
  })

  it("uses one create window per content type", async () => {
    const webContents = {
      on: vi.fn(),
      loadURL: vi.fn(),
    }
    const window = {
      webContents,
      focus: vi.fn(),
      isDestroyed: vi.fn(() => false),
      isMinimized: vi.fn(() => false),
      once: vi.fn(),
      on: vi.fn(),
      show: vi.fn(),
    }
    const createWindow = vi.fn(() => window as never)
    const loadWindow = vi.fn(async () => undefined)
    const service = createContentWindowService({
      createWindow,
      createHealthService: vi.fn(() => ({ attach: vi.fn(), detach: vi.fn() })),
      getAppPath: () => "/app",
      getIconPath: () => null,
      getPreloadPath: () => "/preload.js",
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      loadWindow,
    })

    await service.openCreateWindow({ contentType: "rule", title: "新建 Rule" })
    await service.openCreateWindow({ contentType: "rule", title: "新建 Rule" })

    expect(createWindow).toHaveBeenCalledTimes(1)
    expect(window.focus).toHaveBeenCalledTimes(1)
  })

  it("uses one edit window per content item", async () => {
    const webContents = {
      on: vi.fn(),
      loadURL: vi.fn(),
    }
    const window = {
      webContents,
      focus: vi.fn(),
      isDestroyed: vi.fn(() => false),
      isMinimized: vi.fn(() => false),
      once: vi.fn(),
      on: vi.fn(),
      show: vi.fn(),
    }
    const createWindow = vi.fn(() => window as never)
    const loadWindow = vi.fn(async () => undefined)
    const service = createContentWindowService({
      createWindow,
      createHealthService: vi.fn(() => ({ attach: vi.fn(), detach: vi.fn() })),
      getAppPath: () => "/app",
      getIconPath: () => null,
      getPreloadPath: () => "/preload.js",
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      loadWindow,
    })

    await service.openEditWindow({
      contentType: "skill",
      id: "skill-1",
      origin: "detail",
      title: "编辑 Skill",
    })
    await service.openEditWindow({
      contentType: "skill",
      id: "skill-1",
      origin: "detail",
      title: "编辑 Skill",
    })

    expect(createWindow).toHaveBeenCalledTimes(1)
    expect(window.focus).toHaveBeenCalledTimes(1)
  })
})
