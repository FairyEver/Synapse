import { BrowserWindow } from "electron"
import path from "node:path"

import { rendererBaseUrl } from "../modules/shared/renderer-base-url"

type AutomationWindowServiceDeps = {
  readonly createWindow: (options: Electron.BrowserWindowConstructorOptions) => BrowserWindow
  readonly baseUrl: () => string
  readonly getPreloadPath?: () => string
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

export function createAutomationWindowService(deps: AutomationWindowServiceDeps) {
  let createWindow: BrowserWindow | null = null
  const editWindows = new Map<string, BrowserWindow>()

  async function openWindow(key: string, params: URLSearchParams): Promise<BrowserWindow> {
    const existing = key === "create" ? createWindow : editWindows.get(key)
    if (existing && !existing.isDestroyed()) {
      focusWindow(existing)
      return existing
    }

    const window = deps.createWindow({
      ...AUTOMATION_EDITOR_WINDOW_BOUNDS,
      title: "Automation Editor",
      webPreferences: {
        preload: deps.getPreloadPath?.() ?? resolveAutomationWindowPreloadPath(__dirname),
        contextIsolation: true,
        sandbox: false,
      },
    })
    const baseUrl = deps.baseUrl()
    const url = `${baseUrl}${baseUrl.includes("?") ? "&" : "?"}${params.toString()}`

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
    })

    try {
      await window.loadURL(url)
    } catch (error) {
      if (key === "create") {
        createWindow = null
      } else {
        editWindows.delete(key)
      }
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
