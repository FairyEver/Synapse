import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => {
  const trayInstances: Array<{
    destroy: ReturnType<typeof vi.fn>
    emit: (event: string) => void
    on: ReturnType<typeof vi.fn>
    setContextMenu: ReturnType<typeof vi.fn>
    setImage: ReturnType<typeof vi.fn>
    setToolTip: ReturnType<typeof vi.fn>
  }> = []

  const Tray = vi.fn(function (this: {
    destroy: ReturnType<typeof vi.fn>
    emit: (event: string) => void
    on: ReturnType<typeof vi.fn>
    setContextMenu: ReturnType<typeof vi.fn>
    setImage: ReturnType<typeof vi.fn>
    setToolTip: ReturnType<typeof vi.fn>
  }) {
    const handlers = new Map<string, () => void>()
    this.destroy = vi.fn()
    this.emit = (event: string) => {
      handlers.get(event)?.()
    }
    this.on = vi.fn((event: string, handler: () => void) => {
      handlers.set(event, handler)
    })
    this.setContextMenu = vi.fn()
    this.setImage = vi.fn()
    this.setToolTip = vi.fn()
    trayInstances.push(this)
  })

  return {
    app: {
      quit: vi.fn(),
    },
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
    Menu: {
      buildFromTemplate: vi.fn((template: unknown[]) => ({ template })),
    },
    nativeImage: {
      createFromPath: vi.fn(() => ({
        getSize: vi.fn(() => ({ width: 16, height: 16 })),
        resize: vi.fn(function (this: unknown) {
          return this
        }),
        setTemplateImage: vi.fn(),
      })),
    },
    nativeTheme: {
      off: vi.fn(),
      on: vi.fn(),
      shouldUseDarkColors: false,
    },
    resolveRuntimeAssetPath: vi.fn((relativePath: string) => `/runtime/${relativePath}`),
    Tray,
    trayInstances,
  }
})

vi.mock("electron", () => ({
  app: mocks.app,
  Menu: mocks.Menu,
  nativeImage: mocks.nativeImage,
  nativeTheme: mocks.nativeTheme,
  Tray: mocks.Tray,
}))

vi.mock("../app-icon-service", () => ({
  resolveRuntimeAssetPath: mocks.resolveRuntimeAssetPath,
}))

vi.mock("../log-store", () => ({
  createMainLogger: () => mocks.logger,
}))

const originalPlatform = process.platform

describe("tray-service", () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    mocks.trayInstances.length = 0
    setPlatform("linux")
  })

  afterEach(async () => {
    const { destroyTray } = await import("../tray-service")
    destroyTray()
    setPlatform(originalPlatform)
  })

  it("does not create a system tray on macOS", async () => {
    setPlatform("darwin")
    const { createTray, destroyTray } = await import("../tray-service")

    createTray(vi.fn())
    destroyTray()

    expect(mocks.Tray).not.toHaveBeenCalled()
    expect(mocks.nativeTheme.on).not.toHaveBeenCalled()
    expect(mocks.Menu.buildFromTemplate).not.toHaveBeenCalled()
  })

  it("creates a clickable system tray outside macOS", async () => {
    setPlatform("linux")
    const onShowWindow = vi.fn()
    const { createTray } = await import("../tray-service")

    createTray(onShowWindow)
    mocks.trayInstances[0]?.emit("click")

    expect(mocks.Tray).toHaveBeenCalledTimes(1)
    expect(mocks.trayInstances[0]?.setToolTip).toHaveBeenCalledWith("Synapse")
    expect(mocks.trayInstances[0]?.setContextMenu).toHaveBeenCalledWith(expect.objectContaining({
      template: expect.arrayContaining([
        expect.objectContaining({ label: "显示 Synapse" }),
        expect.objectContaining({ label: "退出" }),
      ]),
    }))
    expect(mocks.nativeTheme.on).toHaveBeenCalledWith("updated", expect.any(Function))
    expect(onShowWindow).toHaveBeenCalledTimes(1)
  })
})

function setPlatform(platform: NodeJS.Platform): void {
  Object.defineProperty(process, "platform", {
    configurable: true,
    value: platform,
  })
}
