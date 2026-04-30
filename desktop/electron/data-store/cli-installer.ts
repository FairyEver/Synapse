import { execFile } from "node:child_process"
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { access, chmod, constants, mkdir } from "node:fs/promises"
import { homedir } from "node:os"
import path from "node:path"
import { promisify } from "node:util"
import { app } from "electron"
import { normalizePathForCompare } from "../../src/lib/path-compare"
import type { DataStoreCliDebugInfo, DataStoreCliStatus } from "../../src/types/data-store"
import { createMainLogger } from "../services/log-store"

const logger = createMainLogger("data-store.cli-installer")
const execFileAsync = promisify(execFile)
const CLI_BIN_NAME = process.platform === "win32" ? "synapse.cmd" : "synapse"
const CLI_TEST_COMMAND = "synapse help"
const PNPM_COMMAND = process.platform === "win32" ? "pnpm.cmd" : "pnpm"

let shellPathEntriesPromise: Promise<string[]> | null = null

function splitPathEntries(rawPath?: string): string[] {
  return (rawPath ?? "")
    .split(path.delimiter)
    .map((entry) => entry.trim())
    .filter(Boolean)
}

function dedupePaths(paths: string[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []

  for (const candidate of paths) {
    const normalized = normalizePathForCompare(candidate, {
      platform: process.platform,
      resolvePath: path.resolve,
    })
    if (seen.has(normalized)) continue
    seen.add(normalized)
    result.push(candidate)
  }

  return result
}

function getKnownCliInstallDirs(): string[] {
  const home = app.getPath("home") || homedir()

  if (process.platform === "win32") {
    const localAppData =
      process.env.LOCALAPPDATA ?? path.join(process.env.USERPROFILE ?? home, "AppData", "Local")

    return [
      path.join(localAppData, "Microsoft", "WindowsApps"),
      path.join(home, "bin"),
    ]
  }

  return [
    path.join(home, ".local", "bin"),
    path.join(home, "bin"),
    "/opt/homebrew/bin",
    "/usr/local/bin",
  ]
}

async function getShellPathEntries(): Promise<string[]> {
  if (process.platform === "win32") {
    return splitPathEntries(process.env.Path ?? process.env.PATH)
  }

  if (shellPathEntriesPromise) {
    return shellPathEntriesPromise
  }

  shellPathEntriesPromise = (async () => {
    const shell = process.env.SHELL || "/bin/zsh"

    try {
      const { stdout } = await execFileAsync(shell, ["-i", "-l", "-c", "env"], { timeout: 2000 })
      const pathLine = stdout
        .split(/\r?\n/)
        .find((line) => line.startsWith("PATH="))

      return splitPathEntries(pathLine?.slice(5))
    } catch (error) {
      logger.debug("Shell PATH lookup missed.", {
        error: error instanceof Error ? error.message : String(error),
        shell,
      })
      return []
    }
  })()

  return shellPathEntriesPromise
}

async function getCombinedPathEntries(): Promise<string[]> {
  return dedupePaths([
    ...splitPathEntries(process.env.Path ?? process.env.PATH),
    ...await getShellPathEntries(),
  ])
}

async function canWriteToDir(dirPath: string): Promise<boolean> {
  try {
    await mkdir(dirPath, { recursive: true })
    await access(dirPath, constants.W_OK)
    return true
  } catch {
    return false
  }
}

async function isExecutableFile(filePath: string): Promise<boolean> {
  if (!existsSync(filePath)) {
    return false
  }

  if (process.platform === "win32") {
    return true
  }

  try {
    await access(filePath, constants.X_OK)
    return true
  } catch {
    return false
  }
}

function fileExists(filePath: string): boolean {
  return existsSync(filePath)
}

function isRuntimeReady(): boolean {
  return fileExists(app.getPath("exe"))
}

function isBundledCliScriptReady(): boolean {
  return fileExists(getBundledCliScriptPath())
}

function isCurrentCliShim(filePath: string): boolean {
  try {
    return readFileSync(filePath, "utf-8") === getCliTargetScript()
  } catch {
    return false
  }
}

async function listCliInstallPaths(): Promise<string[]> {
  const allDirs = dedupePaths([
    ...await getCombinedPathEntries(),
    ...getKnownCliInstallDirs(),
  ])

  return allDirs.map((dirPath) => path.join(dirPath, CLI_BIN_NAME))
}

async function findInstalledCliPath(): Promise<string | null> {
  const candidatePaths = await listCliInstallPaths()

  for (const candidatePath of candidatePaths) {
    if (existsSync(candidatePath)) {
      return candidatePath
    }
  }

  return null
}

async function pickCliInstallPath(): Promise<string> {
  const knownDirs = getKnownCliInstallDirs()
  const pathDirs = await getCombinedPathEntries()

  // Prefer known standard dirs, then fall back to whatever is in PATH.
  // This avoids installing into unrelated tool directories that happen to appear first in PATH.
  const candidateDirs = dedupePaths([...knownDirs, ...pathDirs])

  for (const dirPath of candidateDirs) {
    if (await canWriteToDir(dirPath)) {
      return path.join(dirPath, CLI_BIN_NAME)
    }
  }

  return path.join(knownDirs[0], CLI_BIN_NAME)
}

function isDirInPath(dirPath: string, pathEntries: string[]): boolean {
  const options = {
    platform: process.platform,
    resolvePath: path.resolve,
  }
  const target = normalizePathForCompare(dirPath, options)
  return pathEntries.some((entry) => normalizePathForCompare(entry, options) === target)
}

function getMcpScriptPath(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, "data-store", "mcp", "index.js")
  }
  return path.join(app.getAppPath(), "dist-data-store", "mcp", "index.js")
}

function getBundledCliScriptPath(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, "data-store", "cli", "index.js")
  }
  return path.join(app.getAppPath(), "dist-data-store", "cli", "index.js")
}

function getCliTargetScript(): string {
  const runtimePath = app.getPath("exe")
  const scriptPath = getBundledCliScriptPath()

  if (process.platform === "win32") {
    return `@echo off\r\nsetlocal\r\nset ELECTRON_RUN_AS_NODE=1\r\n"${runtimePath}" "${scriptPath}" %*\r\n`
  }
  return `#!/bin/sh\nexport ELECTRON_RUN_AS_NODE=1\nexec "${runtimePath}" "${scriptPath}" "$@"\n`
}

async function ensureCliBundleReady(): Promise<void> {
  if (app.isPackaged || isBundledCliScriptReady()) {
    return
  }

  logger.info("Building data-store CLI bundle for development install.", {
    cwd: app.getAppPath(),
  })

  await execFileAsync(PNPM_COMMAND, ["build:data-store"], {
    cwd: app.getAppPath(),
    timeout: 120000,
  })
}

async function installCli(): Promise<{ success: boolean; path: string; error?: string }> {
  const existingPath = await findInstalledCliPath()
  const targetPath = existingPath ?? await pickCliInstallPath()

  try {
    await ensureCliBundleReady()

    const dir = path.dirname(targetPath)
    await mkdir(dir, { recursive: true })

    writeFileSync(targetPath, getCliTargetScript(), "utf-8")

    if (process.platform !== "win32") {
      await chmod(targetPath, 0o755)
    }

    const status = await getCliStatus()
    logger.info("CLI installed.", {
      available: status.available,
      path: targetPath,
      pathInShell: status.pathInShell,
    })
    return { success: true, path: targetPath }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    logger.error("CLI installation failed.", { error: message })
    return { success: false, path: targetPath, error: message }
  }
}

async function getCliStatus(): Promise<DataStoreCliStatus> {
  const installedPath = await findInstalledCliPath()
  const pathEntries = await getCombinedPathEntries()
  const targetPath = installedPath ?? await pickCliInstallPath()
  const executable = installedPath ? await isExecutableFile(installedPath) : false
  const pathInShell = isDirInPath(path.dirname(targetPath), pathEntries)
  const runtimeExists = isRuntimeReady()
  const bundledScriptExists = isBundledCliScriptReady()
  const shimCurrent = installedPath ? isCurrentCliShim(installedPath) : false

  return {
    installed: installedPath !== null,
    path: targetPath,
    executable,
    pathInShell,
    runtimeExists,
    bundledScriptExists,
    shimCurrent,
    available:
      installedPath !== null
      && executable
      && pathInShell
      && runtimeExists
      && bundledScriptExists
      && shimCurrent,
  }
}

async function getCliDebugInfo(): Promise<DataStoreCliDebugInfo> {
  const status = await getCliStatus()
  const shellPathEntries = await getShellPathEntries()
  const processPath = process.env.Path ?? process.env.PATH ?? ""
  const combinedPathEntries = dedupePaths([
    ...splitPathEntries(processPath),
    ...shellPathEntries,
  ])

  return {
    checkedAt: new Date().toISOString(),
    platform: process.platform,
    shell: process.env.SHELL ?? "",
    isPackaged: app.isPackaged,
    processExecPath: process.execPath,
    runtimePath: app.getPath("exe"),
    bundledScriptPath: getBundledCliScriptPath(),
    cliBinName: CLI_BIN_NAME,
    testCommand: CLI_TEST_COMMAND,
    installedPath: status.installed ? status.path : null,
    preferredInstallPath: await pickCliInstallPath(),
    knownInstallDirs: getKnownCliInstallDirs(),
    installPathCandidates: await listCliInstallPaths(),
    processPathEntries: splitPathEntries(processPath),
    shellPathEntries,
    combinedPathEntries,
    environment: {
      home: app.getPath("home") || homedir(),
      processPath,
      shellPath: shellPathEntries.join(path.delimiter),
      localAppData: process.env.LOCALAPPDATA ?? "",
      appData: process.env.APPDATA ?? "",
      userProfile: process.env.USERPROFILE ?? "",
    },
    status,
  }
}

export { getCliDebugInfo, installCli, getCliStatus, getMcpScriptPath }
