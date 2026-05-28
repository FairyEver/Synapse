/**
 * Synapse main process entry point.
 *
 * Phase 0.1 (T1.8): main.ts orchestrates lifecycle, everything else lives in
 * `bootstrap/*` and `runtime/*`. SPEC §3 requires this file < 120 lines.
 */

import { app, dialog } from "electron"
import { createMainLogger } from "./services/log-store"
import { accountService } from "./services/account-service"
import { installStatusCacheService } from "./services/install-status-cache-service"
import { repositoryStore } from "./services/repository-store"
import type { EventBus } from "./runtime/event-bus"
import type { IpcHandlerContext } from "./runtime/ipc/types"
import type { WindowManager } from "./runtime/window"
import {
  attachActivateHandler,
  attachBeforeQuitHandler,
  attachOpenUrlHandler,
  attachProcessLevelLogging,
  attachSecondInstanceFocus,
  attachSecondInstanceProtocolHandler,
  buildServiceRegistry,
  clearStaleSingletonLock,
  configureWindowsAppIdentity,
  createIpcRegistry,
  createMainWindow,
  createMainWindowState,
  registerAuthProtocol,
  showOrCreateMainWindow,
} from "./bootstrap"

const logger = createMainLogger("main")
const mainWindowState = createMainWindowState()
let allowAppQuit = false
let windowManager: WindowManager | undefined
const pendingProtocolUrls: string[] = process.argv.filter((item) => item.startsWith("synapse://"))
let canHandleProtocolUrls = false

attachProcessLevelLogging()
configureWindowsAppIdentity()
registerAuthProtocol()

function focusOrCreateMainWindow(): void {
  showOrCreateMainWindow({
    state: mainWindowState,
    windowManager,
    isAppQuitting: () => allowAppQuit,
  })
}

function handleProtocolUrl(url: string): void {
  pendingProtocolUrls.push(url)
  if (canHandleProtocolUrls) {
    void drainProtocolUrls()
  }
}

function isAccountAuthCallbackUrl(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl)
    return parsed.protocol === "synapse:" && parsed.hostname === "auth" && parsed.pathname === "/callback"
  } catch {
    return (
      rawUrl === "synapse://auth/callback" ||
      rawUrl.startsWith("synapse://auth/callback?") ||
      rawUrl.startsWith("synapse://auth/callback#")
    )
  }
}

async function drainProtocolUrls(): Promise<number> {
  let handledCount = 0
  for (const url of pendingProtocolUrls.splice(0)) {
    const isAccountAuthCallback = isAccountAuthCallbackUrl(url)
    if (isAccountAuthCallback) handledCount += 1
    try {
      await accountService.handleAuthCallback(url)
    } catch (error) {
      logger.warn("Failed to handle account auth callback.", { error })
    } finally {
      focusOrCreateMainWindow()
    }
  }
  return handledCount
}

let gotSingleInstanceLock = app.requestSingleInstanceLock()
if (!gotSingleInstanceLock && clearStaleSingletonLock()) {
  gotSingleInstanceLock = app.requestSingleInstanceLock()
}

if (!gotSingleInstanceLock) {
  console.error("[Synapse] Another instance is already running. Exiting.")
  logger.warn("Another Synapse instance is already running. Exiting current process.")
  app.quit()
} else {
  attachSecondInstanceFocus(mainWindowState)
  attachOpenUrlHandler(handleProtocolUrl)
  attachSecondInstanceProtocolHandler(handleProtocolUrl)

  app
    .whenReady()
    .then(async () => {
      logger.info("Electron app is ready. Initializing IPC registry.")

      const registry = buildServiceRegistry({
        trayShowOrCreate: focusOrCreateMainWindow,
      })

      // Register new IpcModules (Phase 0.3)
      const ipcCtx: IpcHandlerContext = {
        moduleId: "main",
        logger,
        resolve: (serviceId) => registry.get(serviceId),
      }
      createIpcRegistry(ipcCtx)

      // Initialize install status cache without making startup depend on editor scans.
      void installStatusCacheService.buildCache().catch((error) => {
        logger.warn("Install status cache initialization failed.", { error })
      })

      const result = await registry.startAll().catch(async (startErr) => {
        await registry.stopAll(10_000).catch((stopErr) => {
          logger.error("stopAll failed during fatal startup cleanup.", { error: stopErr })
        })
        throw startErr
      })
      if (result.degraded.length > 0) {
        for (const failure of result.degraded) {
          logger.warn("Service started in degraded state.", {
            id: failure.id,
            error: failure.error,
          })
        }
        void dialog.showMessageBox({
          type: "warning",
          title: "部分功能不可用",
          message: "部分服务启动失败。",
          detail: result.degraded.map((f) => `${f.id}: ${f.error?.message ?? "未知错误"}`).join("\n"),
          buttons: ["知道了"],
        })
      }

      logger.info("Service registry started. Creating main window.")
      windowManager = registry.get<WindowManager>("core.window-manager")
      createMainWindow({
        state: mainWindowState,
        windowManager,
        isAppQuitting: () => allowAppQuit,
      })

      attachActivateHandler(focusOrCreateMainWindow)

      // Phase 0.4: Use EventBus for cross-window repository update notifications.
      const eventBus = registry.get<EventBus>("core.event-bus")
      accountService.setEventBus(eventBus)
      canHandleProtocolUrls = true
      const handledProtocolUrls = await drainProtocolUrls()
      if (handledProtocolUrls === 0) {
        void accountService.refreshFromStorage()
      }

      repositoryStore.onRepositoryDisappeared((repositoryUuid) => {
        eventBus.emit({
          domain: "repository",
          type: "repository.disappeared",
          payload: { repositoryUuid },
          timestamp: new Date().toISOString(),
        })
      })

      attachBeforeQuitHandler({
        state: mainWindowState,
        registry,
        setAllowQuit: (v) => {
          allowAppQuit = v
        },
        isAllowedToQuit: () => allowAppQuit,
      })
    })
    .catch((error) => {
      logger.error("Failed to initialize app.", error)
      const message = error instanceof Error ? error.message : String(error)
      dialog.showErrorBox(
        "Synapse AI Studio 启动失败",
        `初始化时遇到错误：\n\n${message}\n\n请检查磁盘空间和文件权限。`,
      )
      app.quit()
    })
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit()
  }
})
