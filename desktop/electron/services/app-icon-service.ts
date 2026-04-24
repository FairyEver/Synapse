import { app } from "electron"
import { existsSync } from "node:fs"
import path from "node:path"

function resolveRuntimeAssetPath(relativePath: string): string | undefined {
  const assetPath = path.join(app.getAppPath(), relativePath)

  return existsSync(assetPath) ? assetPath : undefined
}

function getWindowIconPath(): string | undefined {
  if (process.platform === "darwin") {
    return undefined
  }

  if (process.platform === "win32") {
    return resolveRuntimeAssetPath("build/icon.ico")
      ?? resolveRuntimeAssetPath("source/icon.png")
  }

  return resolveRuntimeAssetPath("source/icon.png")
    ?? resolveRuntimeAssetPath("build/icon.ico")
}

function initializeAppIcon(): void {
  if (process.platform !== "darwin") {
    return
  }

  const dockIconPath = resolveRuntimeAssetPath("source/icon.png")

  if (dockIconPath) {
    app.dock?.setIcon(dockIconPath)
  }
}

export { getWindowIconPath, initializeAppIcon, resolveRuntimeAssetPath }
