/**
 * Phase 0.1 — Main window factory + show/focus helpers.
 *
 * Extracted from `main.ts` so the entry point only orchestrates lifecycle.
 * Phase 0.3 (T3.12) replaces this with WindowManager.
 */

import { app, BrowserWindow, dialog } from "electron"
import path from "node:path"
import { DEFAULT_WINDOW_BOUNDS } from "../../src/constants/defaults"
import { managedBrowserWindow, type WindowManager } from "../runtime/window"
import { getWindowIconPath } from "../services/app-icon-service"
import { createMainLogger } from "../services/log-store"
import { RendererHealthService } from "../services/renderer-health"

const logger = createMainLogger("bootstrap.main-window")
const healthLogger = createMainLogger("renderer-health")
const RENDERER_CRASH_LOOP_WINDOW_MS = 60_000
let lastRendererCrashAt = 0

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
  readonly onRendererUnavailable?: (rendererId: number) => void | Promise<void>
  readonly onRendererUnresponsive?: (rendererId: number) => void | Promise<void>
  readonly onRendererResponsive?: (rendererId: number) => void | Promise<void>
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
  const rendererHealthService = new RendererHealthService({
    logger: healthLogger,
    onUnresponsive: async (target) => {
      deps.windowManager?.detach("main")
      await deps.onRendererUnresponsive?.(target.id)
    },
    onResponsive: async (target) => {
      deps.windowManager?.attach({ id: "main", role: "main" }, managedBrowserWindow(window, "main"))
      await deps.onRendererResponsive?.(target.id)
    },
    onUnavailable: async (target) => {
      const failedAt = Date.now()
      const repeated = failedAt - lastRendererCrashAt <= RENDERER_CRASH_LOOP_WINDOW_MS
      lastRendererCrashAt = failedAt
      deps.windowManager?.detach("main")
      const stopAgent = Promise.resolve().then(() => deps.onRendererUnavailable?.(target.id))
      if (repeated) {
        await loadMainRenderer(window, "failed").catch(() => undefined)
        await stopAgent
        await showNativeRendererRecoveryDialog(window)
        return
      }
      const recoveryLoaded = await loadMainRenderer(window, "loading").then(() => true, () => false)
      await stopAgent
      if (!recoveryLoaded) {
        await showNativeRendererRecoveryDialog(window)
        return
      }
      await loadMainRenderer(window)
      deps.windowManager?.attach({ id: "main", role: "main" }, managedBrowserWindow(window, "main"))
    },
  })
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

  loadMainRenderer(window).catch((error) => {
    logger.error("Failed to load renderer.", { error })
    void showNativeRendererRecoveryDialog(window)
  })

  return window
}

function loadMainRenderer(
  window: BrowserWindow,
  recoveryMode?: "loading" | "failed",
): Promise<void> {
  const devServerUrl = process.env.VITE_DEV_SERVER_URL
  if (devServerUrl) {
    const url = new URL(devServerUrl)
    if (recoveryMode) url.searchParams.set("rendererRecovery", recoveryMode)
    logger.info("Loading renderer from Vite dev server.", { recoveryMode })
    return window.loadURL(url.toString())
  }
  const indexPath = path.join(__dirname, "../../../dist/index.html")
  logger.info("Loading renderer from built files.", { indexPath, recoveryMode })
  return window.loadFile(indexPath, recoveryMode ? { query: { rendererRecovery: recoveryMode } } : undefined)
}

async function showNativeRendererRecoveryDialog(window: BrowserWindow): Promise<void> {
  const result = await dialog.showMessageBox(window, {
    type: "error",
    title: "界面恢复失败",
    message: "界面恢复失败",
    buttons: ["重新打开", "退出应用"],
    defaultId: 0,
    cancelId: 1,
  })
  if (result.response === 0) {
    lastRendererCrashAt = 0
    await loadMainRenderer(window).catch(() => undefined)
    return
  }
  app.quit()
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
