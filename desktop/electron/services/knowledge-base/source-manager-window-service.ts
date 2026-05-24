import { app, BrowserWindow } from "electron"
import path from "node:path"
import type { SynapseKnowledgeBaseOpenSourceManagerPayload } from "../../../src/types/knowledge-base"
import { getWindowIconPath } from "../app-icon-service"
import { createMainLogger } from "../log-store"
import { RendererHealthService } from "../renderer-health"

const logger = createMainLogger("knowledge-base-source-manager-window")
const sourceManagerWindows = new Set<BrowserWindow>()
const sourceManagerWindowHealthServices = new WeakMap<BrowserWindow, SourceManagerWindowHealth>()
const SOURCE_MANAGER_WINDOW_BOUNDS = {
  width: 1120,
  height: 760,
  minWidth: 760,
  minHeight: 560,
}

type SourceManagerWindowHealth = {
  attach: (webContents: Electron.WebContents) => void
  detach: () => void
}

type SourceManagerWindowLogger = {
  info: (message: string, meta?: unknown) => void
  warn: (message: string, meta?: unknown) => void
  error: (message: string, meta?: unknown) => void
}

type SourceManagerWindowServiceDeps = {
  createWindow: (options: Electron.BrowserWindowConstructorOptions) => BrowserWindow
  createHealthService: (payload: SynapseKnowledgeBaseOpenSourceManagerPayload) => SourceManagerWindowHealth
  getAppPath: () => string
  getIconPath: () => string | null
  getPreloadPath: () => string
  logger: SourceManagerWindowLogger
  loadWindow?: (
    window: BrowserWindow,
    payload: SynapseKnowledgeBaseOpenSourceManagerPayload,
  ) => Promise<void>
}

function buildSearchParams(payload: SynapseKnowledgeBaseOpenSourceManagerPayload): URLSearchParams {
  const searchParams = new URLSearchParams()
  searchParams.set("window", "knowledge-source-manager")
  searchParams.set("projectId", payload.projectId)
  searchParams.set("projectName", payload.projectName)
  return searchParams
}

async function loadSourceManagerWindow(
  window: BrowserWindow,
  payload: SynapseKnowledgeBaseOpenSourceManagerPayload,
): Promise<void> {
  const searchParams = buildSearchParams(payload)
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

function createSourceManagerWindowKey(payload: SynapseKnowledgeBaseOpenSourceManagerPayload): string {
  return payload.projectId
}

function createWindowLogMetadata(payload: SynapseKnowledgeBaseOpenSourceManagerPayload): Record<string, string> {
  return {
    projectId: payload.projectId,
  }
}

function createRendererHealthLabel(payload: SynapseKnowledgeBaseOpenSourceManagerPayload): string {
  return `knowledge-base.source-manager.${payload.projectId}`
}

function createKnowledgeBaseSourceManagerWindowService(deps: SourceManagerWindowServiceDeps) {
  const windowsByKey = new Map<string, BrowserWindow>()

  return {
    async open(payload: SynapseKnowledgeBaseOpenSourceManagerPayload): Promise<void> {
      const key = createSourceManagerWindowKey(payload)
      const existingWindow = windowsByKey.get(key)
      if (existingWindow && !existingWindow.isDestroyed()) {
        if (existingWindow.isMinimized()) {
          existingWindow.restore()
        }
        existingWindow.focus()
        deps.logger.info("Focused existing knowledge base source manager window.", createWindowLogMetadata(payload))
        return
      }

      const icon = deps.getIconPath()
      const window = deps.createWindow({
        ...SOURCE_MANAGER_WINDOW_BOUNDS,
        resizable: true,
        show: false,
        title: `资料管理 · ${payload.projectName}`,
        ...(icon ? { icon } : {}),
        webPreferences: {
          preload: deps.getPreloadPath(),
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
        },
      })

      sourceManagerWindows.add(window)
      windowsByKey.set(key, window)
      const health = deps.createHealthService(payload)
      health.attach(window.webContents)
      sourceManagerWindowHealthServices.set(window, health)

      window.webContents.on("preload-error", (_event, _preloadPath, error) => {
        deps.logger.error("Knowledge base source manager preload script failed.", { error })
      })

      window.once("ready-to-show", () => {
        window.show()
      })

      window.on("closed", () => {
        health.detach()
        sourceManagerWindowHealthServices.delete(window)
        sourceManagerWindows.delete(window)
        windowsByKey.delete(key)
      })

      await (deps.loadWindow ?? loadSourceManagerWindow)(window, payload)
    },
  }
}

const knowledgeBaseSourceManagerWindowService = createKnowledgeBaseSourceManagerWindowService({
  createWindow: (options) => new BrowserWindow(options),
  createHealthService: (payload) => new RendererHealthService({
    logger: createMainLogger(`renderer-health.${createRendererHealthLabel(payload)}`),
  }),
  getAppPath: () => app.getAppPath(),
  getIconPath: () => getWindowIconPath() ?? null,
  getPreloadPath: () => path.join(__dirname, "../../preload.js"),
  logger,
})

export { createKnowledgeBaseSourceManagerWindowService, knowledgeBaseSourceManagerWindowService }
