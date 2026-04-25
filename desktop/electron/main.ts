/**
 * Synapse main process entry point.
 *
 * Phase 0.1 (T1.8): main.ts orchestrates lifecycle, everything else lives in
 * `bootstrap/*` and `runtime/*`. SPEC §3 requires this file < 120 lines.
 */

import { BrowserWindow, app, dialog } from "electron"
import { SYNAPSE_IPC_CHANNELS } from "./ipc/channels"
import { createMainLogger } from "./services/log-store"
import { repositoryStore } from "./services/repository-store"
import {
  attachActivateHandler,
  attachBeforeQuitHandler,
  attachProcessLevelLogging,
  attachSecondInstanceFocus,
  buildServiceRegistry,
  clearStaleSingletonLock,
  createMainWindow,
  createMainWindowState,
  registerAllIpcHandlers,
  showOrCreateMainWindow,
} from "./bootstrap"

const logger = createMainLogger("main")
const mainWindowState = createMainWindowState()
let allowAppQuit = false

attachProcessLevelLogging()

function focusOrCreateMainWindow(): void {
  showOrCreateMainWindow({
    state: mainWindowState,
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
      logger.info("Electron app is ready. Registering IPC handlers.")
      registerAllIpcHandlers()

      const registry = buildServiceRegistry({
        trayShowOrCreate: focusOrCreateMainWindow,
      })

      const result = await registry.startAll()
      if (result.degraded.length > 0) {
        for (const failure of result.degraded) {
          logger.warn("Service started in degraded state.", {
            id: failure.id,
            error: failure.error,
          })
        }
      }

      logger.info("Service registry started. Creating main window.")
      createMainWindow({
        state: mainWindowState,
        isAppQuitting: () => allowAppQuit,
      })

      attachActivateHandler(focusOrCreateMainWindow)

      // Phase 0.4 (T4.5) replaces this direct webContents.send with EventBus.
      repositoryStore.onRepositoryDisappeared((repositoryUuid) => {
        for (const window of BrowserWindow.getAllWindows()) {
          window.webContents.send(SYNAPSE_IPC_CHANNELS.repository.updated, repositoryUuid)
        }
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
        "Synapse 启动失败",
        `初始化时遇到错误：\n\n${message}\n\n请检查磁盘空间和文件权限。`,
      )
      app.quit()
    })
}

app.on("window-all-closed", () => {
  // 托盘保持运行，不退出
})
