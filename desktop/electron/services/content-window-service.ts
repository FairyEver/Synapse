import { app, BrowserWindow } from "electron"
import path from "node:path"
import { DEFAULT_WINDOW_BOUNDS } from "../../src/constants/defaults"
import { buildContentWindowSearchParams } from "../../src/lib/content-window"
import type { SynapseOpenContentWindowPayload } from "../../src/types/content"
import { getWindowIconPath } from "./app-icon-service"
import { createMainLogger } from "./log-store"
import { RendererHealthService } from "./renderer-health"

const logger = createMainLogger("content-window")
const contentWindows = new Set<BrowserWindow>()
const contentWindowHealthServices = new WeakMap<BrowserWindow, ContentWindowHealth>()
const CONTENT_DETAIL_WINDOW_BOUNDS = {
  width: 1280,
  height: 760,
  minWidth: 1120,
  minHeight: DEFAULT_WINDOW_BOUNDS.minHeight,
}

type ContentWindowLogger = {
  info: (message: string, meta?: unknown) => void
  warn: (message: string, meta?: unknown) => void
  error: (message: string, meta?: unknown) => void
}

type ContentWindowHealth = {
  attach: (webContents: Electron.WebContents) => void
  detach: () => void
}

type ContentWindowServiceDeps = {
  createWindow: (options: Electron.BrowserWindowConstructorOptions) => BrowserWindow
  createHealthService: (payload: SynapseOpenContentWindowPayload) => ContentWindowHealth
  getAppPath: () => string
  getIconPath: () => string | null
  getPreloadPath: () => string
  logger: ContentWindowLogger
  loadWindow?: (window: BrowserWindow, payload: SynapseOpenContentWindowPayload) => Promise<void>
}

async function loadContentWindow(
  window: BrowserWindow,
  payload: SynapseOpenContentWindowPayload,
): Promise<void> {
  const searchParams = buildContentWindowSearchParams(payload)
  const devServerUrl = process.env.VITE_DEV_SERVER_URL

  if (devServerUrl) {
    const url = new URL(devServerUrl)

    for (const [key, value] of searchParams.entries()) {
      url.searchParams.set(key, value)
    }

    await window.loadURL(url.toString())
    return
  }

  await window.loadFile(path.join(app.getAppPath(), "dist/index.html"), {
    query: Object.fromEntries(searchParams.entries()),
  })
}

function createContentWindowKey(payload: SynapseOpenContentWindowPayload): string {
  return `${payload.contentType}:${payload.id}`
}

function createContentWindowService(deps: ContentWindowServiceDeps) {
  const windowsByContent = new Map<string, BrowserWindow>()

  return {
    async openDetailWindow(payload: SynapseOpenContentWindowPayload): Promise<void> {
      const windowKey = createContentWindowKey(payload)
      const existingWindow = windowsByContent.get(windowKey)

      if (existingWindow && !existingWindow.isDestroyed()) {
        if (existingWindow.isMinimized()) {
          existingWindow.restore()
        }
        existingWindow.focus()
        deps.logger.info("Focused existing content detail window.", {
          contentId: payload.id,
          contentType: payload.contentType,
        })
        return
      }

      const { width, height, minWidth, minHeight } = CONTENT_DETAIL_WINDOW_BOUNDS
      const icon = deps.getIconPath()
      const window = deps.createWindow({
        width,
        height,
        minWidth,
        minHeight,
        show: false,
        title: payload.title,
        ...(icon ? { icon } : {}),
        webPreferences: {
          preload: deps.getPreloadPath(),
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
        },
      })

      contentWindows.add(window)
      windowsByContent.set(windowKey, window)
      const health = deps.createHealthService(payload)
      health.attach(window.webContents)
      contentWindowHealthServices.set(window, health)

      window.webContents.on("preload-error", (_event, preloadPath, error) => {
        deps.logger.error("Content window preload script failed.", { error })
      })

      window.once("ready-to-show", () => {
        window.show()
      })

      window.on("closed", () => {
        health.detach()
        contentWindowHealthServices.delete(window)
        contentWindows.delete(window)
        windowsByContent.delete(windowKey)
      })

      await (deps.loadWindow ?? loadContentWindow)(window, payload)
    },
  }
}

const contentWindowService = createContentWindowService({
  createWindow: (options) => new BrowserWindow(options),
  createHealthService: (payload) => new RendererHealthService({
    logger: createMainLogger(`renderer-health.content.${payload.contentType}.${payload.id}`),
  }),
  getAppPath: () => app.getAppPath(),
  getIconPath: () => getWindowIconPath() ?? null,
  getPreloadPath: () => path.join(__dirname, "../preload.js"),
  logger,
})

export { contentWindowService, createContentWindowService }
