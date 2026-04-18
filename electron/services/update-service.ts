import { createHash } from "node:crypto"
import { createWriteStream } from "node:fs"
import { access, mkdir, rename, rm } from "node:fs/promises"
import type { OutgoingHttpHeaders } from "node:http"
import path from "node:path"
import { Readable, Transform } from "node:stream"
import { pipeline } from "node:stream/promises"
import { app, BrowserWindow, shell } from "electron"
import * as electronUpdater from "electron-updater"
import type {
  AppUpdater,
  ResolvedUpdateFileInfo,
  UpdateInfo,
} from "electron-updater"
import type { SynapseAppUpdateState } from "../../src/types/update"
import { SYNAPSE_IPC_CHANNELS } from "../ipc/channels"
import { isTrustedRendererContents } from "../ipc/validated-ipc"
import { createMainLogger } from "./log-store"

const autoUpdater: AppUpdater = electronUpdater.autoUpdater
const logger = createMainLogger("updater")

type UpdateInfoAndProviderLike = {
  info: UpdateInfo
  provider: {
    resolveFiles: (updateInfo: UpdateInfo) => ResolvedUpdateFileInfo[]
  }
}

type AppUpdaterWithResolvedFiles = AppUpdater & {
  updateInfoAndProvider: UpdateInfoAndProviderLike | null
}

function isSupportedPlatform(): boolean {
  return process.platform === "darwin" || process.platform === "win32"
}

function isUpdateSupportedInCurrentEnvironment(): boolean {
  return app.isPackaged && isSupportedPlatform()
}

function createUnsupportedMessage(): string {
  if (!app.isPackaged) {
    return "仅生产版本支持检查更新。"
  }

  return "当前系统暂不支持软件内更新。"
}

function createBaseState(): SynapseAppUpdateState {
  const isSupported = isUpdateSupportedInCurrentEnvironment()

  return {
    currentVersion: app.getVersion(),
    releaseVersion: null,
    status: isSupported ? "idle" : "unsupported",
    message: isSupported ? "可以检查新版本。" : createUnsupportedMessage(),
    error: null,
    downloadPercent: null,
    bytesPerSecond: null,
    transferredBytes: null,
    totalBytes: null,
    lastCheckedAt: null,
    canCheck: isSupported,
    downloadedFilePath: null,
  }
}

function cloneState(state: SynapseAppUpdateState): SynapseAppUpdateState {
  return structuredClone(state)
}

function isFileNotFoundError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === "ENOENT"
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await access(targetPath)
    return true
  } catch (error) {
    if (isFileNotFoundError(error)) {
      return false
    }

    throw error
  }
}

function toFetchHeaders(headers: OutgoingHttpHeaders | null): Record<string, string> | undefined {
  if (!headers) {
    return undefined
  }

  const nextHeaders: Record<string, string> = {}

  for (const [key, value] of Object.entries(headers)) {
    if (value === undefined) {
      continue
    }

    nextHeaders[key] = Array.isArray(value) ? value.join(", ") : String(value)
  }

  return Object.keys(nextHeaders).length > 0 ? nextHeaders : undefined
}

function getResolvedFileName(fileInfo: ResolvedUpdateFileInfo, fallbackVersion: string): string {
  const baseName = path.posix.basename(decodeURIComponent(fileInfo.url.pathname)).trim()

  if (baseName.length > 0) {
    return baseName
  }

  const extension = path.extname(fileInfo.info.url ?? "").trim() || ".zip"
  return `Synapse-${fallbackVersion}${extension}`
}

function getPreferredArtifactExtensions(): string[] {
  if (process.platform === "darwin") {
    return [".dmg", ".zip"]
  }

  if (process.platform === "win32") {
    return [".exe"]
  }

  return []
}

function pickInstallerFile(files: ResolvedUpdateFileInfo[]): ResolvedUpdateFileInfo | null {
  const preferredExtensions = getPreferredArtifactExtensions()

  for (const extension of preferredExtensions) {
    const match = files.find((file) => path.extname(file.url.pathname).toLowerCase() === extension)

    if (match) {
      return match
    }
  }

  return files[0] ?? null
}

class UpdateService {
  private initialized = false
  private state: SynapseAppUpdateState = createBaseState()

  initialize(): void {
    if (this.initialized) {
      return
    }

    this.initialized = true
    this.state = createBaseState()

    if (!isUpdateSupportedInCurrentEnvironment()) {
      logger.info("App updater disabled in current environment.", {
        currentVersion: this.state.currentVersion,
        isPackaged: app.isPackaged,
        platform: process.platform,
      })
      return
    }

    autoUpdater.logger = logger
    autoUpdater.autoDownload = false
    autoUpdater.autoInstallOnAppQuit = false

    autoUpdater.on("checking-for-update", () => {
      logger.info("Checking for updates.")
      this.setState({
        status: "checking",
        message: "正在检查更新...",
        error: null,
        releaseVersion: null,
        downloadPercent: null,
        bytesPerSecond: null,
        transferredBytes: null,
        totalBytes: null,
        canCheck: false,
        downloadedFilePath: null,
      })
    })

    autoUpdater.on("update-available", (updateInfo) => {
      logger.info("Update is available.", {
        version: updateInfo.version,
      })
      this.handleUpdateAvailable(updateInfo)
    })

    autoUpdater.on("update-not-available", (updateInfo) => {
      logger.info("No update available.", {
        version: updateInfo.version,
      })
      this.setState({
        status: "not-available",
        message: "当前已经是最新版本。",
        error: null,
        releaseVersion: updateInfo.version,
        downloadPercent: null,
        bytesPerSecond: null,
        transferredBytes: null,
        totalBytes: null,
        lastCheckedAt: new Date().toISOString(),
        canCheck: true,
        downloadedFilePath: null,
      })
    })

    autoUpdater.on("error", (error) => {
      logger.error("App updater reported an error.", error)
      this.handleError(error)
    })

    logger.info("App updater initialized.", {
      currentVersion: this.state.currentVersion,
      platform: process.platform,
    })
  }

  getState(): SynapseAppUpdateState {
    this.initialize()
    return cloneState(this.state)
  }

  async checkForUpdates(): Promise<SynapseAppUpdateState> {
    this.initialize()

    if (!isUpdateSupportedInCurrentEnvironment()) {
      return this.getState()
    }

    if (this.state.status === "checking" || this.state.status === "downloading") {
      return this.getState()
    }

    try {
      await autoUpdater.checkForUpdates()
      return this.getState()
    } catch (error) {
      this.handleError(error)
      return this.getState()
    }
  }

  private handleUpdateAvailable(updateInfo: UpdateInfo): void {
    this.setState({
      status: "available",
      message: `发现新版本 v${updateInfo.version}，正在下载到下载目录...`,
      error: null,
      releaseVersion: updateInfo.version,
      lastCheckedAt: new Date().toISOString(),
      downloadPercent: 0,
      bytesPerSecond: null,
      transferredBytes: 0,
      totalBytes: null,
      canCheck: false,
      downloadedFilePath: null,
    })

    void this.downloadLatestUpdatePackage(updateInfo).catch((error) => {
      logger.error("Failed to download update package.", error)
      this.handleError(error)
    })
  }

  private async downloadLatestUpdatePackage(updateInfo: UpdateInfo): Promise<void> {
    const fileInfo = this.resolveInstallerFile(updateInfo)
    const fileName = getResolvedFileName(fileInfo, updateInfo.version)
    const downloadsDir = app.getPath("downloads")

    await mkdir(downloadsDir, { recursive: true })

    const destinationPath = await this.createUniqueDownloadPath(downloadsDir, fileName)
    const tempPath = `${destinationPath}.download`
    const expectedSize = this.getExpectedTotalBytes(fileInfo)
    const startedAt = Date.now()
    const hash = createHash("sha512")

    this.setState({
      status: "downloading",
      message: "正在下载更新包到下载目录...",
      error: null,
      downloadPercent: expectedSize === null ? null : 0,
      bytesPerSecond: null,
      transferredBytes: 0,
      totalBytes: expectedSize,
      canCheck: false,
      downloadedFilePath: null,
    })

    try {
      const response = await fetch(fileInfo.url, {
        headers: toFetchHeaders(autoUpdater.requestHeaders),
        redirect: "follow",
      })

      if (!response.ok || !response.body) {
        throw new Error("下载更新包失败，请稍后再试。")
      }

      const totalBytes = this.resolveResponseTotalBytes(response, fileInfo)
      let transferredBytes = 0
      let lastProgressAt = 0

      const progressStream = new Transform({
        transform: (chunk, _encoding, callback) => {
          const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)

          transferredBytes += buffer.length
          hash.update(buffer)

          const now = Date.now()

          if (lastProgressAt === 0 || now - lastProgressAt >= 200) {
            lastProgressAt = now
            this.updateDownloadProgress(updateInfo, transferredBytes, totalBytes, startedAt)
          }

          callback(null, buffer)
        },
      })

      await pipeline(
        Readable.fromWeb(response.body as globalThis.ReadableStream<Uint8Array>),
        progressStream,
        createWriteStream(tempPath),
      )

      const actualSha512 = hash.digest("base64")

      if (fileInfo.info.sha512 && actualSha512 !== fileInfo.info.sha512) {
        throw new Error("下载的更新包校验失败，请重新检查更新。")
      }

      this.updateDownloadProgress(updateInfo, transferredBytes, totalBytes, startedAt)

      await rename(tempPath, destinationPath)

      logger.info("Update package downloaded to downloads directory.", {
        version: updateInfo.version,
        destinationPath,
      })

      shell.showItemInFolder(destinationPath)

      this.setState({
        status: "downloaded",
        message: `新版本 v${updateInfo.version} 已下载到下载目录，并已打开所在位置。`,
        error: null,
        releaseVersion: updateInfo.version,
        downloadPercent: 100,
        bytesPerSecond: this.state.bytesPerSecond,
        transferredBytes,
        totalBytes,
        canCheck: true,
        downloadedFilePath: destinationPath,
      })
    } catch (error) {
      await rm(tempPath, { force: true }).catch(() => {})
      throw error
    }
  }

  private updateDownloadProgress(
    updateInfo: UpdateInfo,
    transferredBytes: number,
    totalBytes: number | null,
    startedAt: number,
  ): void {
    const elapsedSeconds = Math.max(1, (Date.now() - startedAt) / 1000)
    const bytesPerSecond = transferredBytes > 0 ? transferredBytes / elapsedSeconds : null

    this.setState({
      status: "downloading",
      message: "正在下载更新包到下载目录...",
      error: null,
      releaseVersion: updateInfo.version,
      downloadPercent: totalBytes && totalBytes > 0 ? (transferredBytes / totalBytes) * 100 : null,
      bytesPerSecond,
      transferredBytes,
      totalBytes,
      canCheck: false,
      downloadedFilePath: null,
    })
  }

  private resolveInstallerFile(updateInfo: UpdateInfo): ResolvedUpdateFileInfo {
    const updaterWithResolvedFiles = autoUpdater as AppUpdaterWithResolvedFiles
    const updateInfoAndProvider = updaterWithResolvedFiles.updateInfoAndProvider

    if (!updateInfoAndProvider) {
      throw new Error("更新信息还没有准备好，请重新检查更新。")
    }

    const resolvedFiles = updateInfoAndProvider.provider.resolveFiles(updateInfoAndProvider.info)
    const installerFile = pickInstallerFile(resolvedFiles)

    if (!installerFile) {
      throw new Error("没有找到可下载的安装包。")
    }

    return installerFile
  }

  private getExpectedTotalBytes(fileInfo: ResolvedUpdateFileInfo): number | null {
    return typeof fileInfo.info.size === "number" && Number.isFinite(fileInfo.info.size) && fileInfo.info.size > 0
      ? fileInfo.info.size
      : null
  }

  private resolveResponseTotalBytes(response: Response, fileInfo: ResolvedUpdateFileInfo): number | null {
    const contentLength = Number.parseInt(response.headers.get("content-length") ?? "", 10)

    if (Number.isFinite(contentLength) && contentLength > 0) {
      return contentLength
    }

    return this.getExpectedTotalBytes(fileInfo)
  }

  private async createUniqueDownloadPath(directoryPath: string, fileName: string): Promise<string> {
    const parsedFile = path.parse(fileName)
    let attempt = 0

    while (true) {
      const suffix = attempt === 0 ? "" : ` (${attempt})`
      const candidatePath = path.join(directoryPath, `${parsedFile.name}${suffix}${parsedFile.ext}`)

      if (!await pathExists(candidatePath) && !await pathExists(`${candidatePath}.download`)) {
        return candidatePath
      }

      attempt += 1
    }
  }

  private handleError(error: unknown): void {
    const message =
      error instanceof Error && error.message.trim()
        ? error.message
        : "检查更新失败，请稍后再试。"

    this.setState({
      status: "error",
      message,
      error: message,
      canCheck: isUpdateSupportedInCurrentEnvironment(),
      downloadedFilePath: null,
    })
  }

  private setState(patch: Partial<SynapseAppUpdateState>): void {
    this.state = {
      ...this.state,
      ...patch,
      currentVersion: app.getVersion(),
    }

    const nextState = cloneState(this.state)

    for (const window of BrowserWindow.getAllWindows()) {
      if (!isTrustedRendererContents(window.webContents)) {
        continue
      }

      window.webContents.send(SYNAPSE_IPC_CHANNELS.update.stateChanged, nextState)
    }
  }
}

const updateService = new UpdateService()

export { updateService }
