/**
 * Phase 0.1 — Main window factory + show/focus helpers.
 *
 * Extracted from `main.ts` so the entry point only orchestrates lifecycle.
 * Phase 0.3 (T3.12) replaces this with WindowManager.
 */

import { app, BrowserWindow } from "electron"
import path from "node:path"
import { DEFAULT_WINDOW_BOUNDS } from "../../src/constants/defaults"
import { managedBrowserWindow, type WindowManager } from "../runtime/window"
import { getWindowIconPath } from "../services/app-icon-service"
import { createMainLogger } from "../services/log-store"
import { RendererHealthService } from "../services/renderer-health"

const logger = createMainLogger("bootstrap.main-window")
const healthLogger = createMainLogger("renderer-health")
const rendererHealthService = new RendererHealthService({
  logger: healthLogger,
})

export interface MainWindowState {
  current: BrowserWindow | null
}

export function createMainWindowState(): MainWindowState {
  return { current: null }
}

export interface MainWindowDeps {
  readonly state: MainWindowState
  readonly windowManager?: WindowManager
  /** True when the app has reached `before-quit` and should not block window close. */
  readonly isAppQuitting: () => boolean
}

export function createMainWindow(deps: MainWindowDeps): BrowserWindow {
  const { width, height, minWidth, minHeight } = DEFAULT_WINDOW_BOUNDS
  const icon = getWindowIconPath()
  const window = new BrowserWindow({
    width,
    height,
    minWidth,
    minHeight,
    show: false,
    title: `Synapse AI Studio ${app.getVersion()}`,
    ...(icon ? { icon } : {}),
    webPreferences: {
      preload: path.join(__dirname, "..", "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  deps.state.current = window
  rendererHealthService.attach(window.webContents)
  deps.windowManager?.attach({ id: "main", role: "main" }, managedBrowserWindow(window, "main"))

  window.webContents.on("preload-error", (_event, preloadPath, error) => {
    logger.error("Preload script failed.", { error })
  })

  attachDevelopmentInputShortcuts(window)

  let pendingFullscreenClose = false

  window.once("ready-to-show", () => {
    logger.info("Main window is ready to show.")
    window.show()
  })

  window.on("close", (event) => {
    if (deps.isAppQuitting()) {
      return
    }

    event.preventDefault()

    if (pendingFullscreenClose) {
      return
    }

    if (window.isFullScreen()) {
      pendingFullscreenClose = true
      window.once("leave-full-screen", () => {
        pendingFullscreenClose = false
        if (deps.isAppQuitting() || window.isDestroyed()) return
        window.hide()
      })
      window.setFullScreen(false)
      return
    }

    window.hide()
  })

  window.on("closed", () => {
    rendererHealthService.detach()
    logger.info("Main window closed.")
    deps.state.current = null
  })

  const devServerUrl = process.env.VITE_DEV_SERVER_URL
  if (devServerUrl) {
    logger.info("Loading renderer from Vite dev server.", { devServerUrl })
    window.loadURL(devServerUrl).catch((error) => {
      logger.error("Failed to load renderer from dev server.", { error })
      window.loadURL(`data:text/html;charset=utf-8,<h2>加载失败</h2><p>${encodeURIComponent(String(error))}</p>`).catch(() => {})
    })
  } else {
    const indexPath = path.join(__dirname, "../../../dist/index.html")
    logger.info("Loading renderer from built files.", { indexPath })
    window.loadFile(indexPath).catch((error) => {
      logger.error("Failed to load renderer from built files.", { error })
      window.loadURL(`data:text/html;charset=utf-8,<h2>加载失败</h2><p>${encodeURIComponent(String(error))}</p>`).catch(() => {})
    })
  }

  return window
}

export function isDevToolsToggleShortcut(input: Electron.Input): boolean {
  if (input.type !== "keyDown") return false
  const key = input.key.toLowerCase()
  const commandOrControl = input.meta || input.control
  return key === "f12" || (commandOrControl && input.alt && key === "i")
}

function attachDevelopmentInputShortcuts(window: BrowserWindow): void {
  if (!process.env.VITE_DEV_SERVER_URL) return

  window.webContents.on("before-input-event", (event, input) => {
    if (!isDevToolsToggleShortcut(input)) return
    event.preventDefault()
    window.webContents.toggleDevTools()
  })
}

export function showOrCreateMainWindow(deps: MainWindowDeps): void {
  if (deps.isAppQuitting()) {
    app.relaunch()
    app.exit(0)
    return
  }
  const existing = deps.state.current
  if (existing && !existing.isDestroyed()) {
    existing.show()
    existing.focus()
    return
  }
  createMainWindow(deps)
}
