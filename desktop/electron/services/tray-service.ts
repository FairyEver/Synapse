import { app, BrowserWindow, Menu, nativeImage, Tray } from "electron"
import { resolveRuntimeAssetPath } from "./app-icon-service"
import { createMainLogger } from "./log-store"

let tray: Tray | null = null
const logger = createMainLogger("tray")

let showWindowCallback: (() => void) | null = null

function createTray(onShowWindow: () => void): void {
  const iconPath = resolveRuntimeAssetPath("source/icon.png")

  if (!iconPath) {
    logger.warn("Tray icon not found. Skipping tray creation.")
    return
  }

  showWindowCallback = onShowWindow

  let icon = nativeImage.createFromPath(iconPath)

  if (process.platform === "darwin") {
    icon = icon.resize({ width: 16, height: 16 })
    icon.setTemplateImage(true)
  }

  tray = new Tray(icon)
  tray.setToolTip("Synapse")

  const contextMenu = Menu.buildFromTemplate([
    {
      label: "显示 Synapse",
      click: () => showWindowCallback?.(),
    },
    { type: "separator" },
    {
      label: "退出",
      click: () => app.quit(),
    },
  ])

  tray.setContextMenu(contextMenu)

  tray.on("click", () => {
    showWindowCallback?.()
  })

  logger.info("System tray created.")
}

function destroyTray(): void {
  if (tray) {
    tray.destroy()
    tray = null
  }
}

export { createTray, destroyTray }
