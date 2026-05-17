/**
 * Synapse main process entry point.
 *
 * Phase 0.1 (T1.8): main.ts orchestrates lifecycle, everything else lives in
 * `bootstrap/*` and `runtime/*`. SPEC §3 requires this file < 120 lines.
 */

import { app, dialog } from "electron"
import { createMainLogger } from "./services/log-store"
import { installStatusCacheService } from "./services/install-status-cache-service"
import { repositoryStore } from "./services/repository-store"
import type { EventBus } from "./runtime/event-bus"
import type { IpcHandlerContext } from "./runtime/ipc/types"
import type { WindowManager } from "./runtime/window"
import {
  attachActivateHandler,
  attachBeforeQuitHandler,
  attachProcessLevelLogging,
  attachSecondInstanceFocus,
  buildServiceRegistry,
  clearStaleSingletonLock,
  configureWindowsAppIdentity,
  createIpcRegistry,
  createMainWindow,
  createMainWindowState,
  showOrCreateMainWindow,
} from "./bootstrap"

const logger = createMainLogger("main")
const mainWindowState = createMainWindowState()
let allowAppQuit = false
let windowManager: WindowManager | undefined

attachProcessLevelLogging()
configureWindowsAppIdentity()

function focusOrCreateMainWindow(): void {
  showOrCreateMainWindow({
    state: mainWindowState,
    windowManager,
    isAppQuitting: () => allowAppQuit,
  })
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

      // Initialize install status cache
      await installStatusCacheService.buildCache()

      const result = await registry.startAll()
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
          detail: result.degraded.map((failure) => failure.id).join("\n"),
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
