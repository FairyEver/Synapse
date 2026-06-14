import { app, BrowserWindow } from "electron"
import path from "node:path"

import { buildContentStoreInstallWindowSearchParams } from "../../src/lib/content-store-install-window"
import type { SynapseContentStoreInstallWindowRequest } from "../../src/types/content-store-install"
import { getWindowIconPath } from "./app-icon-service"
import { contentStoreInstallService } from "./content-store-install-service"
import { createMainLogger } from "./log-store"
import { RendererHealthService } from "./renderer-health"

const CONTENT_STORE_INSTALL_WINDOW_BOUNDS = {
  width: 1280,
  height: 820,
  minWidth: 1120,
  minHeight: 680,
}

type ContentStoreInstallWindowHealth = {
  attach: (webContents: Electron.WebContents) => void
  detach: () => void
}

type ContentStoreInstallWindowLogger = {
  info: (message: string, meta?: unknown) => void
  warn: (message: string, meta?: unknown) => void
  error: (message: string, meta?: unknown) => void
}

type ContentStoreInstallWindowServiceDeps = {
  createWindow: (options: Electron.BrowserWindowConstructorOptions) => BrowserWindow
  createHealthService: (request: SynapseContentStoreInstallWindowRequest) => ContentStoreInstallWindowHealth
  getAppPath: () => string
  getIconPath: () => string | null
  getPreloadPath: () => string
  logger: ContentStoreInstallWindowLogger
  cleanupSession?: (sessionId: string) => Promise<void>
  loadWindow?: (
    window: BrowserWindow,
    request: SynapseContentStoreInstallWindowRequest,
  ) => Promise<void>
}

async function loadContentStoreInstallWindow(
  window: BrowserWindow,
  request: SynapseContentStoreInstallWindowRequest,
  appPath: string,
): Promise<void> {
  const searchParams = buildContentStoreInstallWindowSearchParams(request)
  const devServerUrl = process.env.VITE_DEV_SERVER_URL

  if (devServerUrl) {
    const url = new URL(devServerUrl)
    for (const [key, value] of searchParams.entries()) {
      url.searchParams.set(key, value)
    }
    await window.loadURL(url.toString())
    return
  }

  await window.loadFile(path.join(appPath, "dist/index.html"), {
    query: Object.fromEntries(searchParams.entries()),
  })
}

function createContentStoreInstallWindowService(deps: ContentStoreInstallWindowServiceDeps) {
  const windowsBySession = new Map<string, BrowserWindow>()

  return {
    async open(request: SynapseContentStoreInstallWindowRequest): Promise<void> {
      const existingWindow = windowsBySession.get(request.session)

      if (existingWindow && !existingWindow.isDestroyed()) {
        if (existingWindow.isMinimized()) existingWindow.restore()
        existingWindow.focus()
        deps.logger.info("Focused existing content store install window.")
        return
      }

      const icon = deps.getIconPath()
      const window = deps.createWindow({
        ...CONTENT_STORE_INSTALL_WINDOW_BOUNDS,
        show: false,
        title: "安装内容",
        ...(icon ? { icon } : {}),
        webPreferences: {
          preload: deps.getPreloadPath(),
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
        },
      })
      const health = deps.createHealthService(request)
      health.attach(window.webContents)
      windowsBySession.set(request.session, window)
      let cleanedUp = false
      const cleanup = () => {
        if (cleanedUp) return
        cleanedUp = true
        health.detach()
        if (windowsBySession.get(request.session) === window) {
          windowsBySession.delete(request.session)
        }
        void deps.cleanupSession?.(request.session).catch((error) => {
          deps.logger.warn("Failed to clean content store install window session.", {
            error,
            sessionIdLength: request.session.length,
          })
        })
      }

      window.webContents.on("preload-error", (_event, _preloadPath, error) => {
        deps.logger.error("Content store install window preload script failed.", { error })
      })
      window.once("ready-to-show", () => window.show())
      window.on("closed", cleanup)

      try {
        await (deps.loadWindow ?? ((targetWindow, targetRequest) =>
          loadContentStoreInstallWindow(targetWindow, targetRequest, deps.getAppPath())))(window, request)
      } catch (error) {
        cleanup()
        deps.logger.error("Failed to load content store install window.", { error })
        if (!window.isDestroyed()) window.close()
        throw error
      }
    },
  }
}

type ContentStoreInstallWindowService = ReturnType<typeof createContentStoreInstallWindowService>

let defaultService: ContentStoreInstallWindowService | null = null

function getDefaultService(): ContentStoreInstallWindowService {
  defaultService ??= createContentStoreInstallWindowService({
    createWindow: (options) => new BrowserWindow(options),
    createHealthService: () => new RendererHealthService({
      logger: createMainLogger("renderer-health.content-store-install"),
    }),
    getAppPath: () => app.getAppPath(),
    getIconPath: () => getWindowIconPath() ?? null,
    getPreloadPath: () => path.join(__dirname, "../preload.js"),
    logger: createMainLogger("content-store-install-window"),
    cleanupSession: (sessionId) => contentStoreInstallService.cleanupIfIdle(sessionId),
  })
  return defaultService
}

const contentStoreInstallWindowService = {
  open(request: SynapseContentStoreInstallWindowRequest): Promise<void> {
    return getDefaultService().open(request)
  },
}

export {
  contentStoreInstallWindowService,
  createContentStoreInstallWindowService,
  loadContentStoreInstallWindow,
}
export type { ContentStoreInstallWindowService }
