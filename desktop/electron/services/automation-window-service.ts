import { BrowserWindow } from "electron"
import path from "node:path"

import { rendererBaseUrl } from "../modules/shared/renderer-base-url"
import { createMainLogger } from "./log-store"

type AutomationWindowLogger = {
  readonly info: (message: string, metadata?: Record<string, unknown>) => void
  readonly warn: (message: string, metadata?: Record<string, unknown>) => void
}

type AutomationWindowServiceDeps = {
  readonly createWindow: (options: Electron.BrowserWindowConstructorOptions) => BrowserWindow
  readonly baseUrl: () => string
  readonly getPreloadPath?: () => string
  readonly logger?: AutomationWindowLogger
}

const AUTOMATION_EDITOR_WINDOW_BOUNDS = {
  width: 950,
  height: 720,
  minWidth: 860,
  minHeight: 560,
}

function focusWindow(window: BrowserWindow): void {
  if (window.isMinimized()) window.restore()
  window.focus()
}

function resolveAutomationWindowPreloadPath(baseDir: string): string {
  return path.join(baseDir, "../preload.js")
}

function automationWindowMetadata(key: string): Record<string, string> {
  return {
    windowKey: key,
    windowMode: key === "create" ? "create" : "edit",
  }
}

function errorDiagnostic(rawError: unknown): Record<string, unknown> {
  const message = rawError instanceof Error ? rawError.message : String(rawError)
  return {
    errorName: rawError instanceof Error ? rawError.name : typeof rawError,
    errorLength: message.length,
  }
}

export function createAutomationWindowService(deps: AutomationWindowServiceDeps) {
  let createWindow: BrowserWindow | null = null
  const editWindows = new Map<string, BrowserWindow>()
  const logger = deps.logger ?? createMainLogger("automation.window")

  async function openWindow(key: string, params: URLSearchParams): Promise<BrowserWindow> {
    const metadata = automationWindowMetadata(key)
    const baseUrl = deps.baseUrl()
    const url = `${baseUrl}${baseUrl.includes("?") ? "&" : "?"}${params.toString()}`
    const existing = key === "create" ? createWindow : editWindows.get(key)
    if (existing && !existing.isDestroyed()) {
      if (key === "create") {
        try {
          await existing.loadURL(url)
          logger.info("Reloaded existing automation editor window.", metadata)
        } catch (error) {
          createWindow = null
          logger.warn("Failed to reload automation editor window.", {
            ...metadata,
            ...errorDiagnostic(error),
          })
          if (!existing.isDestroyed()) existing.destroy()
          throw error
        }
      }
      focusWindow(existing)
      logger.info("Focused existing automation editor window.", metadata)
      return existing
    }

    logger.info("Opening automation editor window.", metadata)
    const window = deps.createWindow({
      ...AUTOMATION_EDITOR_WINDOW_BOUNDS,
      title: "Automation Editor",
      webPreferences: {
        preload: deps.getPreloadPath?.() ?? resolveAutomationWindowPreloadPath(__dirname),
        contextIsolation: true,
        sandbox: false,
      },
    })

    if (key === "create") {
      createWindow = window
    } else {
      editWindows.set(key, window)
    }

    window.on("closed", () => {
      if (key === "create") {
        createWindow = null
      } else {
        editWindows.delete(key)
      }
      logger.info("Automation editor window closed.", metadata)
    })

    try {
      await window.loadURL(url)
      logger.info("Loaded automation editor window.", metadata)
    } catch (error) {
      if (key === "create") {
        createWindow = null
      } else {
        editWindows.delete(key)
      }
      logger.warn("Failed to load automation editor window.", {
        ...metadata,
        ...errorDiagnostic(error),
      })
      if (!window.isDestroyed()) window.destroy()
      throw error
    }

    return window
  }

  return {
    openCreate(): Promise<BrowserWindow> {
      return openWindow("create", new URLSearchParams({ window: "automation-editor", mode: "create" }))
    },
    openEdit(automationId: string): Promise<BrowserWindow> {
      return openWindow(automationId, new URLSearchParams({ window: "automation-editor", mode: "edit", automationId }))
    },
  }
}

export const automationWindowService = createAutomationWindowService({
  createWindow: (options) => new BrowserWindow(options),
  baseUrl: rendererBaseUrl,
  getPreloadPath: () => resolveAutomationWindowPreloadPath(__dirname),
})
