import { app, BrowserWindow } from "electron"
import path from "node:path"
import { DEFAULT_WINDOW_BOUNDS } from "../src/constants/defaults"
import { registerContentHandlers } from "./ipc/content-handlers"
import { registerConfigHandlers } from "./ipc/config-handlers"
import { registerLogHandlers } from "./ipc/log-handlers"
import { registerRepositoryHandlers } from "./ipc/repository-handlers"
import { registerUpdateHandlers } from "./ipc/update-handlers"
import { configStore } from "./services/config-store"
import { createMainLogger } from "./services/log-store"
import { updateService } from "./services/update-service"

let mainWindow: BrowserWindow | null = null
const logger = createMainLogger("main")

function createMainWindow() {
  const { width, height, minWidth, minHeight } = DEFAULT_WINDOW_BOUNDS
  const window = new BrowserWindow({
    width,
    height,
    minWidth,
    minHeight,
    show: false,
    title: "Synapse",
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
    registerContentHandlers()
    registerLogHandlers()
    registerConfigHandlers()
    registerRepositoryHandlers()
    registerUpdateHandlers()
    await configStore.load()
    updateService.initialize()

    logger.info("Core services initialized. Creating main window.")
    createMainWindow()

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
