import { app, Menu, nativeImage, nativeTheme, Tray } from "electron"
import { resolveRuntimeAssetPath } from "./app-icon-service"
import { createMainLogger } from "./log-store"

let tray: Tray | null = null
const logger = createMainLogger("tray")

let showWindowCallback: (() => void) | null = null
let themeUpdateHandler: (() => void) | null = null

function resolveTrayIconPath(): string | undefined {
  if (process.platform === "darwin") {
    return resolveRuntimeAssetPath("source/tray/tray-Template.png")
      ?? resolveRuntimeAssetPath("source/icon.png")
  }

  const variant = nativeTheme.shouldUseDarkColors ? "tray-dark" : "tray-light"
  return resolveRuntimeAssetPath(`source/tray/${variant}.png`)
    ?? resolveRuntimeAssetPath("source/icon.png")
}

function buildTrayImage(iconPath: string) {
  let icon = nativeImage.createFromPath(iconPath)

  if (process.platform === "darwin") {
    const { width, height } = icon.getSize()
    if (width > 16 || height > 16) {
      icon = icon.resize({ width: 16, height: 16 })
    }
    icon.setTemplateImage(true)
  }

  return icon
}

function applyCurrentIcon(): void {
  if (!tray) return

  const iconPath = resolveTrayIconPath()
  if (!iconPath) {
    logger.warn("Tray icon not found on theme update. Keeping previous icon.")
    return
  }

  tray.setImage(buildTrayImage(iconPath))
}

function createTray(onShowWindow: () => void): void {
  if (process.platform === "darwin") {
    logger.info("System tray skipped on macOS.")
    return
  }

  const iconPath = resolveTrayIconPath()

  if (!iconPath) {
    logger.warn("Tray icon not found. Skipping tray creation.")
    return
  }

  showWindowCallback = onShowWindow

  tray = new Tray(buildTrayImage(iconPath))
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

  themeUpdateHandler = () => applyCurrentIcon()
  nativeTheme.on("updated", themeUpdateHandler)

  logger.info("System tray created.")
}

function destroyTray(): void {
  if (themeUpdateHandler) {
    nativeTheme.off("updated", themeUpdateHandler)
    themeUpdateHandler = null
  }

  if (tray) {
    tray.destroy()
    tray = null
  }
}

export { createTray, destroyTray }
