import { app, BrowserWindow } from "electron"
import path from "node:path"

function createMainWindow() {
  const mainWindow = new BrowserWindow({
    width: 1000,
    height: 600,
    minWidth: 1000,
    minHeight: 600,
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

  mainWindow.once("ready-to-show", () => {
    mainWindow.show()
  })

  const devServerUrl = process.env.VITE_DEV_SERVER_URL

  if (devServerUrl) {
    void mainWindow.loadURL(devServerUrl)
  } else {
    void mainWindow.loadFile(path.join(__dirname, "../dist/index.html"))
  }
}

app.whenReady().then(() => {
  createMainWindow()

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow()
    }
  })
})

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit()
  }
})
