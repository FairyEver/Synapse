import { app, BrowserWindow } from "electron"
import path from "node:path"

import type { SynapseToolDefinition } from "../../../src/types/tools"
import { getWindowIconPath } from "../app-icon-service"
import { createMainLogger } from "../log-store"
import { RendererHealthService } from "../renderer-health"
import { requireToolDefinition } from "./tool-registry"

type ToolWindowLogger = {
  info(message: string, meta?: unknown): void
  warn(message: string, meta?: unknown): void
  error(message: string, meta?: unknown): void
}

type ToolWindowHealth = {
  attach(webContents: Electron.WebContents): void
  detach(): void
}

type ToolWindowServiceDeps = {
  createWindow(options: Electron.BrowserWindowConstructorOptions): BrowserWindow
  createHealthService(tool: SynapseToolDefinition): ToolWindowHealth
  getIconPath(): string | null
  getPreloadPath(): string
  logger: ToolWindowLogger
  loadWindow?: (window: BrowserWindow, tool: SynapseToolDefinition) => Promise<void>
}

export type ToolWindowService = {
  open(toolId: string): Promise<void>
}

const toolWindowHealthServices = new WeakMap<BrowserWindow, ToolWindowHealth>()

function buildSearchParams(tool: SynapseToolDefinition): URLSearchParams {
  const searchParams = new URLSearchParams()
  searchParams.set("window", "tool")
  searchParams.set("toolId", tool.id)
  return searchParams
}

async function loadToolWindow(window: BrowserWindow, tool: SynapseToolDefinition): Promise<void> {
  const searchParams = buildSearchParams(tool)
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

export function createToolWindowService(deps: ToolWindowServiceDeps): ToolWindowService {
  const windowsByToolId = new Map<string, BrowserWindow>()

  return {
    async open(toolId: string): Promise<void> {
      const tool = requireToolDefinition(toolId)
      const existingWindow = windowsByToolId.get(tool.id)
      if (existingWindow && !existingWindow.isDestroyed()) {
        if (existingWindow.isMinimized()) {
          existingWindow.restore()
        }
        existingWindow.focus()
        deps.logger.info("Focused existing tool window.", { toolId: tool.id })
        return
      }

      const icon = deps.getIconPath()
      const window = deps.createWindow({
        ...tool.bounds,
        resizable: true,
        show: false,
        title: tool.windowTitle,
        ...(icon ? { icon } : {}),
        webPreferences: {
          preload: deps.getPreloadPath(),
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
        },
      })

      windowsByToolId.set(tool.id, window)
      const health = deps.createHealthService(tool)
      health.attach(window.webContents)
      toolWindowHealthServices.set(window, health)

      window.webContents.on("preload-error", (_event, _preloadPath, error) => {
        deps.logger.error("Tool window preload script failed.", { toolId: tool.id, error })
      })

      window.once("ready-to-show", () => {
        window.show()
      })

      window.on("closed", () => {
        health.detach()
        toolWindowHealthServices.delete(window)
        windowsByToolId.delete(tool.id)
      })

      await (deps.loadWindow ?? loadToolWindow)(window, tool)
    },
  }
}

const logger = createMainLogger("tools.window")

export const toolWindowService = createToolWindowService({
  createWindow: (options) => new BrowserWindow(options),
  createHealthService: (tool) => new RendererHealthService({
    logger: createMainLogger(`renderer-health.tools.${tool.id}`),
  }),
  getIconPath: () => getWindowIconPath() ?? null,
  getPreloadPath: () => path.join(__dirname, "../../preload.js"),
  logger,
})
