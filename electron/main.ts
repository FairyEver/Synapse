import { app, BrowserWindow, dialog } from "electron"
import path from "node:path"
import { DEFAULT_WINDOW_BOUNDS } from "../src/constants/defaults"
import { SYNAPSE_IPC_CHANNELS } from "./ipc/channels"
import { registerCliHandlers } from "./ipc/cli-handlers"
import { registerContentHandlers } from "./ipc/content-handlers"
import { registerConfigHandlers } from "./ipc/config-handlers"
import { registerEditorHandlers } from "./ipc/editor-handlers"
import { registerIdentityHandlers } from "./ipc/identity-handlers"
import { registerLogHandlers } from "./ipc/log-handlers"
import { registerRepositoryHandlers } from "./ipc/repository-handlers"
import { registerShellHandlers } from "./ipc/shell-handlers"
import { registerUpdateHandlers } from "./ipc/update-handlers"
import { registerUserProfileHandlers } from "./ipc/user-profile-handlers"
import { getWindowIconPath, initializeAppIcon } from "./services/app-icon-service"
import { configStore } from "./services/config-store"
import { contentSubmissionService } from "./services/content-submission-service"
import { createMainLogger, logStore } from "./services/log-store"
import { pendingPushesService } from "./services/pending-pushes-service"
import { repositoryMaintenanceService } from "./services/repository-maintenance-service"
import { repositoryStore } from "./services/repository-store"
import { updateService } from "./services/update-service"

let mainWindow: BrowserWindow | null = null
let allowAppQuit = false
const logger = createMainLogger("main")

function createMainWindow() {
  const { width, height, minWidth, minHeight } = DEFAULT_WINDOW_BOUNDS
  const icon = getWindowIconPath()
  const window = new BrowserWindow({
    width,
    height,
    minWidth,
    minHeight,
    show: false,
    title: "Synapse",
    ...(icon ? { icon } : {}),
    ...(process.platform === "darwin" ? { titleBarStyle: "hiddenInset" as const } : {}),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  mainWindow = window

  window.webContents.on("preload-error", (_event, preloadPath, error) => {
    logger.error("Preload script failed.", {
      error,
      preloadPath,
    })
  })

  window.once("ready-to-show", () => {
    logger.info("Main window is ready to show.")
    window.show()
  })

  window.on("closed", () => {
    logger.info("Main window closed.")
    mainWindow = null
  })

  const devServerUrl = process.env.VITE_DEV_SERVER_URL

  if (devServerUrl) {
    logger.info("Loading renderer from Vite dev server.", { devServerUrl })
    void window.loadURL(devServerUrl)
  } else {
    logger.info("Loading renderer from built files.")
    void window.loadFile(path.join(__dirname, "../../dist/index.html"))
  }
}

process.on("uncaughtException", (error) => {
  logger.error("Uncaught exception in main process.", error)
})

process.on("unhandledRejection", (reason) => {
  logger.error("Unhandled rejection in main process.", reason)
})

const gotSingleInstanceLock = app.requestSingleInstanceLock()

if (!gotSingleInstanceLock) {
  logger.warn("Another Synapse instance is already running. Exiting current process.")
  app.quit()
} else {
  app.on("second-instance", () => {
    if (!mainWindow) {
      return
    }

    if (mainWindow.isMinimized()) {
      mainWindow.restore()
    }

    logger.info("A second instance was requested. Focusing the existing window.")
    mainWindow.focus()
  })

  app.whenReady().then(async () => {
    logger.info("Electron app is ready. Registering services.")
    initializeAppIcon()
    registerCliHandlers()
    registerContentHandlers()
    registerEditorHandlers()
    registerLogHandlers()
    registerConfigHandlers()
    registerIdentityHandlers()
    registerShellHandlers()
    registerUserProfileHandlers()
    registerRepositoryHandlers()
    registerUpdateHandlers()
    await configStore.load()
    updateService.initialize()
    updateService.startAutoCheck()

    logger.info("Core services initialized. Creating main window.")
    createMainWindow()

    void (async () => {
      const config = await configStore.load()

      for (const repository of config.repositories) {
        repositoryStore.watchRepository(repository)

        try {
          await repositoryMaintenanceService.runScheduledMaintenanceIfDue(repository)
        } catch (error) {
          logger.warn("Scheduled repository maintenance failed.", {
            error,
            repositoryUuid: repository.uuid,
          })
        }
      }
    })()

    repositoryStore.onRepositoryDisappeared((repositoryUuid) => {
      for (const window of BrowserWindow.getAllWindows()) {
        window.webContents.send(SYNAPSE_IPC_CHANNELS.repository.updated, repositoryUuid)
      }
    })

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        logger.info("App activated with no windows. Recreating main window.")
        createMainWindow()
      }
    })
  }).catch((error) => {
    logger.error("Failed to initialize app services.", error)
    app.quit()
  })
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    logger.info("All windows closed. Quitting app on non-macOS platform.")
    app.quit()
  }
})

app.on("before-quit", async (event) => {
  // 取消正在进行的下载并清理临时文件
  await updateService.cancelDownload()

  if (allowAppQuit) {
    // 确保日志被刷新
    await logStore.dispose()
    return
  }

  event.preventDefault()

  void (async () => {
    try {
      await logStore.flush()

      const config = await configStore.load()
      const pendingPushCount = await pendingPushesService.countAll(config.repositories)

      if (pendingPushCount === 0) {
        allowAppQuit = true
        app.quit()
        return
      }

      const ownerWindow = mainWindow ?? BrowserWindow.getAllWindows()[0] ?? null
      const result = ownerWindow
        ? await dialog.showMessageBox(ownerWindow, {
            type: "warning",
            title: "还有未同步的变更",
            message: `你有 ${pendingPushCount} 条变更未同步到仓库。`,
            detail: "下次启动时可以继续推送。",
            buttons: ["先同步", "继续退出"],
            defaultId: 0,
            cancelId: 1,
          })
        : await dialog.showMessageBox({
            type: "warning",
            title: "还有未同步的变更",
            message: `你有 ${pendingPushCount} 条变更未同步到仓库。`,
            detail: "下次启动时可以继续推送。",
            buttons: ["先同步", "继续退出"],
            defaultId: 0,
            cancelId: 1,
          })

      if (result.response === 0) {
        for (const repository of config.repositories) {
          await contentSubmissionService.flushPendingPushes(repository)
        }
      }

      allowAppQuit = true
      app.quit()
    } catch (error) {
      logger.error("Failed to resolve before-quit pending pushes flow.", error)

      if (mainWindow) {
        await dialog.showMessageBox(mainWindow, {
          type: "error",
          title: "无法完成同步",
          message: error instanceof Error ? error.message : "同步失败。",
          buttons: ["关闭"],
        })
      }
    }
  })()
})
