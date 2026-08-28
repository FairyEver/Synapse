import { app, BrowserWindow } from "electron"
import path from "node:path"
import { DEFAULT_WINDOW_BOUNDS } from "../../../src/constants/defaults"
import { buildCcConversationWindowSearchParams } from "../../../src/lib/cc-conversation-window"
import type { CcConversationWindowRequest } from "../../../src/types/usage-analysis-conversations"
import { getWindowIconPath } from "../app-icon-service"
import { createMainLogger } from "../log-store"
import { RendererHealthService } from "../renderer-health"

const WINDOW_BOUNDS = {
  width: 1360,
  height: 820,
  minWidth: 1120,
  minHeight: DEFAULT_WINDOW_BOUNDS.minHeight,
}

const WINDOW_TITLE = "Synapse AI Studio CC 对话详情"

type Logger = {
  info: (message: string, meta?: unknown) => void
  warn: (message: string, meta?: unknown) => void
  error: (message: string, meta?: unknown) => void
}

type Health = {
  attach: (webContents: Electron.WebContents) => void
  detach: () => void
}

type Deps = {
  createWindow: (options: Electron.BrowserWindowConstructorOptions) => BrowserWindow
  createHealthService: (payload: CcConversationWindowRequest) => Health
  getAppPath: () => string
  getIconPath: () => string | null
  getPreloadPath: () => string
  logger: Logger
  loadWindow?: (window: BrowserWindow, payload: CcConversationWindowRequest) => Promise<void>
}

async function loadConversationWindow(
  window: BrowserWindow,
  payload: CcConversationWindowRequest,
  appPath: string,
): Promise<void> {
  const searchParams = buildCcConversationWindowSearchParams(payload)
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

export function resolveCcConversationWindowPreloadPath(baseDir: string): string {
  return path.join(baseDir, "../../preload.js")
}

export function createCcConversationWindowService(deps: Deps) {
  const windowsBySession = new Map<string, BrowserWindow>()

  return {
    async openConversationWindow(payload: CcConversationWindowRequest): Promise<void> {
      const existingWindow = windowsBySession.get(payload.sessionId)

      if (existingWindow && !existingWindow.isDestroyed()) {
        if (existingWindow.isMinimized()) {
          existingWindow.restore()
        }
        await (deps.loadWindow ?? ((targetWindow, targetPayload) =>
          loadConversationWindow(targetWindow, targetPayload, deps.getAppPath())))(existingWindow, payload)
        existingWindow.focus()
        deps.logger.info("Focused existing CC conversation window.", {
          sessionId: payload.sessionId,
          hasFocus: Boolean(payload.focus),
        })
        return
      }

      const icon = deps.getIconPath()
      const window = deps.createWindow({
        ...WINDOW_BOUNDS,
        show: false,
        title: WINDOW_TITLE,
        ...(icon ? { icon } : {}),
        webPreferences: {
          preload: deps.getPreloadPath(),
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
        },
      })
      const health = deps.createHealthService(payload)
      health.attach(window.webContents)
      windowsBySession.set(payload.sessionId, window)
      let cleanedUp = false
      const cleanupWindowTracking = () => {
        if (cleanedUp) return
        cleanedUp = true
        health.detach()
        windowsBySession.delete(payload.sessionId)
      }

      window.webContents.on("preload-error", (_event, _preloadPath, error) => {
        deps.logger.error("CC conversation window preload script failed.", { error })
      })

      window.on("page-title-updated", (event) => {
        event.preventDefault()
      })

      window.once("ready-to-show", () => {
        window.show()
      })

      window.on("closed", () => {
        cleanupWindowTracking()
      })

      try {
        await (deps.loadWindow ?? ((targetWindow, targetPayload) =>
          loadConversationWindow(targetWindow, targetPayload, deps.getAppPath())))(window, payload)
      } catch (error) {
        cleanupWindowTracking()
        deps.logger.error("Failed to load CC conversation window.", {
          error,
          sessionId: payload.sessionId,
        })
        if (!window.isDestroyed()) {
          window.close()
        }
        throw error
      }
    },
  }
}

type CcConversationWindowService = ReturnType<typeof createCcConversationWindowService>

let defaultService: CcConversationWindowService | null = null

function getDefaultService(): CcConversationWindowService {
  defaultService ??= createCcConversationWindowService({
    createWindow: (options) => new BrowserWindow(options),
    createHealthService: (payload) => new RendererHealthService({
      logger: createMainLogger(`renderer-health.cc-conversation.${payload.sessionId}`),
    }),
    getAppPath: () => app.getAppPath(),
    getIconPath: () => getWindowIconPath() ?? null,
    getPreloadPath: () => resolveCcConversationWindowPreloadPath(__dirname),
    logger: createMainLogger("cc-conversation-window"),
  })
  return defaultService
}

export const ccConversationWindowService = {
  openConversationWindow(payload: CcConversationWindowRequest): Promise<void> {
    return getDefaultService().openConversationWindow(payload)
  },
}
