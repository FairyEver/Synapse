import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs"
import { chmod } from "node:fs/promises"
import path from "node:path"
import { app } from "electron"
import { createMainLogger } from "../services/log-store"

const logger = createMainLogger("data-store.cli-installer")

function getCliScriptPath(): string {
  if (process.platform === "win32") {
    const appData = process.env.LOCALAPPDATA ?? path.join(process.env.USERPROFILE ?? "", "AppData", "Local")
    return path.join(appData, "Microsoft", "WindowsApps", "synd.cmd")
  }
  return "/usr/local/bin/synd"
}

function getMcpScriptPath(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, "data-store", "mcp", "index.js")
  }
  return path.join(app.getAppPath(), "dist-data-store", "mcp", "index.js")
}

function getCliTargetScript(): string {
  let scriptPath: string
  if (app.isPackaged) {
    scriptPath = path.join(process.resourcesPath, "data-store", "cli", "index.js")
  } else {
    scriptPath = path.join(app.getAppPath(), "dist-data-store", "cli", "index.js")
  }

  if (process.platform === "win32") {
    return `@echo off\r\nnode "${scriptPath}" %*\r\n`
  }
  return `#!/bin/sh\nexec node "${scriptPath}" "$@"\n`
}

async function installCli(): Promise<{ success: boolean; path: string; error?: string }> {
  const targetPath = getCliScriptPath()

  try {
    const dir = path.dirname(targetPath)
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }

    writeFileSync(targetPath, getCliTargetScript(), "utf-8")

    if (process.platform !== "win32") {
      await chmod(targetPath, 0o755)
    }

    logger.info("CLI installed.", { path: targetPath })
    return { success: true, path: targetPath }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    logger.error("CLI installation failed.", { error: message })
    return { success: false, path: targetPath, error: message }
  }
}

function getCliStatus(): { installed: boolean; path: string } {
  const targetPath = getCliScriptPath()
  const installed = existsSync(targetPath)
  return { installed, path: targetPath }
}

export { installCli, getCliStatus, getMcpScriptPath }
