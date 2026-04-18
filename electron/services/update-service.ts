import { app, BrowserWindow } from "electron"
import * as electronUpdater from "electron-updater"
import type {
  AppUpdater,
  ProgressInfo,
  UpdateDownloadedEvent,
  UpdateInfo,
} from "electron-updater"
import type { SynapseAppUpdateState } from "../../src/types/update"
import { SYNAPSE_IPC_CHANNELS } from "../ipc/channels"
import { isTrustedRendererContents } from "../ipc/validated-ipc"
import { createMainLogger } from "./log-store"

const autoUpdater: AppUpdater = electronUpdater.autoUpdater
const logger = createMainLogger("updater")

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
    canRestartToInstall: false,
  }
}

function cloneState(state: SynapseAppUpdateState): SynapseAppUpdateState {
  return structuredClone(state)
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
        canRestartToInstall: false,
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
        canRestartToInstall: false,
      })
    })

    autoUpdater.on("download-progress", (progressInfo) => {
      this.handleDownloadProgress(progressInfo)
    })

    autoUpdater.on("update-downloaded", (event) => {
      logger.info("Update downloaded.", {
        version: event.version,
      })
      this.handleUpdateDownloaded(event)
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

    if (this.state.status === "downloaded") {
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

  async quitAndInstall(): Promise<void> {
    this.initialize()

    if (!this.state.canRestartToInstall) {
      throw new Error("更新还没有下载完成。")
    }

    logger.info("Restarting app to install downloaded update.", {
      version: this.state.releaseVersion,
    })
    autoUpdater.quitAndInstall()
  }

  private handleUpdateAvailable(updateInfo: UpdateInfo): void {
    this.setState({
      status: "available",
      message: `发现新版本 v${updateInfo.version}，正在下载更新包...`,
      error: null,
      releaseVersion: updateInfo.version,
      lastCheckedAt: new Date().toISOString(),
      downloadPercent: 0,
      bytesPerSecond: null,
      transferredBytes: 0,
      totalBytes: null,
      canCheck: false,
      canRestartToInstall: false,
    })

    void autoUpdater.downloadUpdate().catch((error) => {
      logger.error("Failed to start update download.", error)
      this.handleError(error)
    })
  }

  private handleDownloadProgress(progressInfo: ProgressInfo): void {
    this.setState({
      status: "downloading",
      message: "正在下载更新包...",
      error: null,
      downloadPercent: progressInfo.percent,
      bytesPerSecond: progressInfo.bytesPerSecond,
      transferredBytes: progressInfo.transferred,
      totalBytes: progressInfo.total,
      canCheck: false,
      canRestartToInstall: false,
    })
  }

  private handleUpdateDownloaded(event: UpdateDownloadedEvent): void {
    this.setState({
      status: "downloaded",
      message: `新版本 v${event.version} 已下载完成，重启后安装。`,
      error: null,
      releaseVersion: event.version,
      downloadPercent: 100,
      canCheck: false,
      canRestartToInstall: true,
    })
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
      canRestartToInstall: false,
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
