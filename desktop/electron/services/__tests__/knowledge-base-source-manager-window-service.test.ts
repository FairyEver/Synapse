import { describe, expect, it, vi } from "vitest"

import { createKnowledgeBaseSourceManagerWindowService } from "../knowledge-base/source-manager-window-service"

describe("createKnowledgeBaseSourceManagerWindowService", () => {
  it("opens a resizable source manager window for a knowledge base project", async () => {
    const webContents = {
      on: vi.fn(),
    }
    const window = {
      webContents,
      once: vi.fn(),
      on: vi.fn(),
      show: vi.fn(),
    }
    const health = { attach: vi.fn(), detach: vi.fn() }
    const createWindow = vi.fn(() => window as never)
    const loadWindow = vi.fn(async () => undefined)
    const service = createKnowledgeBaseSourceManagerWindowService({
      createWindow,
      createHealthService: vi.fn(() => health),
      getAppPath: () => "/app",
      getIconPath: () => null,
      getPreloadPath: () => "/preload.js",
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      loadWindow,
    })

    await service.open({
      projectId: "project-1",
      projectPath: "/tmp/kb",
      projectName: "知识库001",
    })

    expect(createWindow).toHaveBeenCalledWith(expect.objectContaining({
      width: 1120,
      height: 760,
      minWidth: 760,
      minHeight: 560,
      resizable: true,
      title: "资料管理 · 知识库001",
    }))
    expect(health.attach).toHaveBeenCalledWith(webContents)
    expect(loadWindow).toHaveBeenCalledWith(window, {
      projectId: "project-1",
      projectPath: "/tmp/kb",
      projectName: "知识库001",
    })
  })

  it("focuses an existing source manager window for the same project", async () => {
    const webContents = {
      on: vi.fn(),
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
    const service = createKnowledgeBaseSourceManagerWindowService({
      createWindow,
      createHealthService: vi.fn(() => ({ attach: vi.fn(), detach: vi.fn() })),
      getAppPath: () => "/app",
      getIconPath: () => null,
      getPreloadPath: () => "/preload.js",
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      loadWindow,
    })

    await service.open({
      projectId: "project-1",
      projectPath: "/tmp/kb",
      projectName: "知识库001",
    })
    await service.open({
      projectId: "project-1",
      projectPath: "/tmp/kb",
      projectName: "知识库001",
    })

    expect(createWindow).toHaveBeenCalledTimes(1)
    expect(loadWindow).toHaveBeenCalledTimes(1)
    expect(window.focus).toHaveBeenCalledTimes(1)
  })
})
