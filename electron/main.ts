import { app, BrowserWindow } from "electron"
import path from "node:path"
import { DEFAULT_WINDOW_BOUNDS } from "../src/constants/defaults"
import { registerConfigHandlers } from "./ipc/config-handlers"
import { configStore } from "./services/config-store"

let mainWindow: BrowserWindow | null = null

function createMainWindow() {
  const { width, height, minWidth, minHeight } = DEFAULT_WINDOW_BOUNDS
  const window = new BrowserWindow({
    width,
    height,
    minWidth,
    minHeight,
    backgroundColor: "#edf2ea",
    show: false,
    title: "Synapse",
    ...(process.platform === "darwin"
      ? {
          titleBarStyle: "hiddenInset" as const,
        }
      : {}),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  mainWindow = window

  window.once("ready-to-show", () => {
    window.show()
  })

  window.on("closed", () => {
    mainWindow = null
  })

  const devServerUrl = process.env.VITE_DEV_SERVER_URL

  if (devServerUrl) {
    void window.loadURL(devServerUrl)
  } else {
    void window.loadFile(path.join(__dirname, "../../dist/index.html"))
  }
}

const gotSingleInstanceLock = app.requestSingleInstanceLock()

if (!gotSingleInstanceLock) {
  app.quit()
} else {
  app.on("second-instance", () => {
    if (!mainWindow) {
      return
    }

    if (mainWindow.isMinimized()) {
      mainWindow.restore()
    }

    mainWindow.focus()
  })

  app.whenReady().then(async () => {
    registerConfigHandlers()
    await configStore.load()

    createMainWindow()

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createMainWindow()
      }
    })
  }).catch((error) => {
    console.error("[main] Failed to initialize app services.", error)
    app.quit()
  })
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit()
  }
})
