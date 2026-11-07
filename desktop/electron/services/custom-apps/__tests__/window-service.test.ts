import { describe, expect, it, vi } from "vitest"
import type { CustomAppDto } from "@synapse/shared"

import {
  CustomWebAppWindowService,
  planCustomWebAppWindowOpen,
} from "../window-service"

const appId = "cwa_123e4567-e89b-42d3-a456-426614174000"

describe("CustomWebAppWindowService", () => {
  it("opens one independent window and focuses it on repeat", async () => {
    const { service, createWindow, window } = createHarness()

    await service.open(appId)
    await service.open(appId)

    expect(createWindow).toHaveBeenCalledTimes(1)
    expect(window.loadURL).toHaveBeenCalledWith(expect.stringContaining("window=custom-app"))
    expect(window.loadURL).toHaveBeenCalledWith(expect.stringContaining(`appId=${appId}`))
    expect(window.focus).toHaveBeenCalledTimes(1)
  })

  it("closes the tracked window and destroys the app runtime", async () => {
    const { service, window, runtime } = createHarness()
    await service.open(appId)
    service.close(appId)

    expect(window.close).toHaveBeenCalled()
    expect(runtime.destroyApp).toHaveBeenCalledWith(appId)
  })
})

describe("planCustomWebAppWindowOpen", () => {
  it("allows OAuth popups within the per-app limit", () => {
    expect(planCustomWebAppWindowOpen({
      url: "https://login.example.com",
      activePopupCount: 0,
    })).toEqual({ action: "allow" })
  })

  it("blocks unsupported protocols and excess popups", () => {
    expect(planCustomWebAppWindowOpen({
      url: "file:///tmp/secret",
      activePopupCount: 0,
    })).toEqual({ action: "deny" })
    expect(planCustomWebAppWindowOpen({
      url: "https://login.example.com",
      activePopupCount: 5,
    })).toEqual({ action: "deny" })
  })
})

function createHarness() {
  const app = customApp()
  const runtime = { destroyApp: vi.fn(), destroyAll: vi.fn() }
  const window = {
    webContents: { id: 10 },
    loadURL: vi.fn().mockResolvedValue(undefined),
    once: vi.fn(),
    on: vi.fn(),
    show: vi.fn(),
    focus: vi.fn(),
    close: vi.fn(),
    isDestroyed: vi.fn(() => false),
    isMinimized: vi.fn(() => false),
    isVisible: vi.fn(() => true),
    restore: vi.fn(),
  }
  const createWindow = vi.fn(() => window)
  const service = new CustomWebAppWindowService({
    getApp: (id) => id === appId ? app : null,
    createWindow: createWindow as never,
    baseUrl: () => "app://index.html",
    getPreloadPath: () => "/tmp/preload.js",
    runtime: runtime as never,
    windowManager: {
      attach: vi.fn(),
      detach: vi.fn(),
    } as never,
    focusMainWindow: vi.fn(),
  })
  return { service, createWindow, window, runtime }
}

function customApp(): CustomAppDto {
  return {
    id: appId,
    kind: "web",
    schemaVersion: 1,
    name: "阅读",
    startUrl: "https://example.com/read",
    iconUrl: null,
    iconSource: "favicon",
    version: 1,
    createdAt: "2026-11-07T00:00:00.000Z",
    updatedAt: "2026-11-07T00:00:00.000Z",
  }
}
