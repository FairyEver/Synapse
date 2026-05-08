import { app, Notification } from "electron"
import { CancellationToken } from "electron-updater"
import * as electronUpdater from "electron-updater"
import type {
  AppUpdater,
  ProgressInfo,
  UpdateDownloadedEvent,
  UpdateInfo,
} from "electron-updater"
import type { SynapseAppUpdateState } from "../../src/types/update"
import type { WindowManager } from "../runtime/window"

// Update event channels for broadcasting state changes
const UPDATE_CHANNELS = {
  stateChanged: "synapse:update:state-changed",
  openUpdatePage: "synapse:update:open-update-page",
} as const
import { createMainLogger } from "./log-store"

const autoUpdater: AppUpdater = electronUpdater.autoUpdater
const logger = createMainLogger("updater")

const AUTO_CHECK_INTERVAL_MS = 60_000
const AUTO_CHECK_INITIAL_DELAY_MS = 60_000

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

function toNullablePositiveNumber(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null
}

class UpdateService {
  private initialized = false
  private state: SynapseAppUpdateState = createBaseState()
  private downloadCancellationToken: CancellationToken | null = null
  private isCancellingDownload = false
  private activeUpdateMode: "manual" | "auto" | null = null
  private lastNotifiedVersion: string | null = null
  private autoCheckTimer: ReturnType<typeof setInterval> | null = null
  private windowManager: WindowManager | null = null
  private beforeInstallQuitHandler: (() => void) | null = null

  setWindowManager(windowManager: WindowManager): void {
    this.windowManager = windowManager
  }

  setBeforeInstallQuitHandler(handler: (() => void) | null): void {
    this.beforeInstallQuitHandler = handler
  }

  private clearDownloadTracking(): void {
    this.downloadCancellationToken = null
    this.isCancellingDownload = false
  }

  private beginUpdateFlow(mode: "manual" | "auto"): void {
    this.activeUpdateMode = mode
  }

  private clearUpdateFlow(mode?: "manual" | "auto"): void {
    if (!mode || this.activeUpdateMode === mode) {
      this.activeUpdateMode = null
    }
  }

  private isManualUpdateFlow(): boolean {
    return this.activeUpdateMode === "manual"
  }

  private isAutoUpdateFlow(): boolean {
    return this.activeUpdateMode === "auto"
  }

  private isDownloadCancelledError(error: unknown): boolean {
    return this.isCancellingDownload || (error instanceof Error && error.message === "cancelled")
  }

  async cancelDownload(): Promise<void> {
    if (this.downloadCancellationToken) {
      logger.info("Cancelling update download.")
      this.isCancellingDownload = true
      this.downloadCancellationToken.cancel()
    }

    if (this.state.status === "downloading" || this.state.status === "available") {
      this.setState({
        status: "idle",
        message: "下载已取消。",
        error: null,
        downloadPercent: null,
        bytesPerSecond: null,
        transferredBytes: null,
        totalBytes: null,
        canCheck: isUpdateSupportedInCurrentEnvironment(),
        downloadedFilePath: null,
      })
    }
  }

  async installUpdate(): Promise<void> {
    this.initialize()

    if (!isUpdateSupportedInCurrentEnvironment()) {
      return
    }

    if (this.state.status !== "downloaded") {
      throw new Error("更新尚未准备好，请先完成下载。")
    }

    logger.info("Installing downloaded update.", {
      version: this.state.releaseVersion,
    })

    try {
      this.beforeInstallQuitHandler?.()
    } catch (error) {
      logger.error("Failed to prepare app quit for update install.", error)
    }

    autoUpdater.quitAndInstall()
  }

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
      if (this.isManualUpdateFlow()) {
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
      }
    })

    autoUpdater.on("update-available", (updateInfo) => {
      logger.info("Update is available.", {
        version: updateInfo.version,
      })
      if (this.isAutoUpdateFlow()) {
        this.handleAutoCheckUpdateAvailable(updateInfo)
      } else if (this.isManualUpdateFlow()) {
        this.handleUpdateAvailable(updateInfo)
      }
    })

    autoUpdater.on("update-not-available", (updateInfo) => {
      logger.info("No update available.", {
        version: updateInfo.version,
      })
      if (this.isManualUpdateFlow()) {
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
      }
      this.clearUpdateFlow()
    })

    autoUpdater.on("download-progress", (progressInfo) => {
      if (this.isManualUpdateFlow()) {
        this.handleDownloadProgress(progressInfo)
      }
    })

    autoUpdater.on("update-downloaded", (event) => {
      logger.info("Update downloaded.", {
        version: event.version,
        downloadedFile: event.downloadedFile,
      })
      if (this.isManualUpdateFlow()) {
        this.handleUpdateDownloaded(event)
      }
    })

    autoUpdater.on("update-cancelled", (updateInfo) => {
      logger.info("Update download cancelled.", {
        version: updateInfo.version,
      })
      if (this.isManualUpdateFlow()) {
        this.handleDownloadCancelled(updateInfo)
      }
    })

    autoUpdater.on("error", (error) => {
      logger.error("App updater reported an error.", error)
      if (this.isManualUpdateFlow()) {
        if (this.isDownloadCancelledError(error)) {
          this.handleDownloadCancelled()
          return
        }

        this.handleError(error)
        return
      }

      if (this.isAutoUpdateFlow()) {
        this.clearUpdateFlow("auto")
      }
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

    if (
      this.state.status === "checking"
      || this.state.status === "available"
      || this.state.status === "downloading"
      || this.state.status === "downloaded"
    ) {
      return this.getState()
    }

    this.beginUpdateFlow("manual")

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
      message: `发现新版本 v${updateInfo.version}，正在准备下载...`,
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

    void this.downloadLatestUpdate(updateInfo).catch((error) => {
      if (this.isDownloadCancelledError(error)) {
        this.handleDownloadCancelled(updateInfo)
        return
      }

      logger.error("Failed to download update.", error)
      this.handleError(error)
    })
  }

  private async downloadLatestUpdate(updateInfo: UpdateInfo): Promise<void> {
    const cancellationToken = new CancellationToken()
    this.downloadCancellationToken = cancellationToken
    this.isCancellingDownload = false
    this.setState({
      status: "downloading",
      message: "正在下载更新...",
      error: null,
      releaseVersion: updateInfo.version,
      downloadPercent: this.state.downloadPercent ?? 0,
      bytesPerSecond: null,
      transferredBytes: this.state.transferredBytes ?? 0,
      totalBytes: this.state.totalBytes,
      canCheck: false,
      downloadedFilePath: null,
    })

    try {
      await autoUpdater.downloadUpdate(cancellationToken)
    } catch (error) {
      if (this.isDownloadCancelledError(error)) {
        return
      }

      throw error
    } finally {
      this.clearDownloadTracking()
    }
  }

  private handleDownloadProgress(progressInfo: ProgressInfo): void {
    this.setState({
      status: "downloading",
      message: "正在下载更新...",
      error: null,
      downloadPercent: toNullablePositiveNumber(progressInfo.percent),
      bytesPerSecond: toNullablePositiveNumber(progressInfo.bytesPerSecond),
      transferredBytes: toNullablePositiveNumber(progressInfo.transferred),
      totalBytes: toNullablePositiveNumber(progressInfo.total),
      canCheck: false,
      downloadedFilePath: null,
    })
  }

  private handleUpdateDownloaded(event: UpdateDownloadedEvent): void {
    this.clearDownloadTracking()
    this.clearUpdateFlow("manual")

    this.setState({
      status: "downloaded",
      message: `新版本 v${event.version} 已准备好，重启后安装。`,
      error: null,
      releaseVersion: event.version,
      downloadPercent: 100,
      transferredBytes: this.state.totalBytes ?? this.state.transferredBytes,
      totalBytes: this.state.totalBytes ?? this.state.transferredBytes,
      canCheck: false,
      downloadedFilePath: event.downloadedFile,
    })
  }

  private handleDownloadCancelled(updateInfo?: UpdateInfo): void {
    this.clearDownloadTracking()
    this.clearUpdateFlow("manual")

    if (this.state.status !== "downloading" && this.state.status !== "available") {
      return
    }

    this.setState({
      status: "idle",
      message: "下载已取消。",
      error: null,
      releaseVersion: updateInfo?.version ?? this.state.releaseVersion,
      downloadPercent: null,
      bytesPerSecond: null,
      transferredBytes: null,
      totalBytes: null,
      canCheck: isUpdateSupportedInCurrentEnvironment(),
      downloadedFilePath: null,
    })
  }

  private handleError(error: unknown): void {
    this.clearDownloadTracking()
    this.clearUpdateFlow()

    const message =
      error instanceof Error && error.message.trim()
        ? error.message
        : "检查更新失败，请稍后再试。"

    this.setState({
      status: "error",
      message,
      error: message,
      downloadPercent: null,
      bytesPerSecond: null,
      transferredBytes: null,
      totalBytes: null,
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

    if (this.windowManager) {
      this.windowManager.broadcast(
        UPDATE_CHANNELS.stateChanged,
        nextState,
      )
    }
  }

  startAutoCheck(): void {
    if (!isUpdateSupportedInCurrentEnvironment()) {
      return
    }

    if (this.autoCheckTimer) {
      return
    }

    const runAutoCheck = () => {
      if (
        this.state.status === "checking"
        || this.state.status === "available"
        || this.state.status === "downloading"
        || this.state.status === "downloaded"
        || this.activeUpdateMode !== null
      ) {
        return
      }

      this.beginUpdateFlow("auto")
      autoUpdater.checkForUpdates().catch((error) => {
        logger.warn("Auto update check failed.", { error })
        this.clearUpdateFlow("auto")
      })
    }

    setTimeout(runAutoCheck, AUTO_CHECK_INITIAL_DELAY_MS)
    this.autoCheckTimer = setInterval(runAutoCheck, AUTO_CHECK_INTERVAL_MS)
  }

  private handleAutoCheckUpdateAvailable(updateInfo: UpdateInfo): void {
    this.clearUpdateFlow("auto")

    if (this.lastNotifiedVersion === updateInfo.version) {
      return
    }

    this.lastNotifiedVersion = updateInfo.version

    if (!Notification.isSupported()) {
      return
    }

    const notification = new Notification({
      title: "Synapse AI Studio",
      body: `新版本 ${updateInfo.version} 已发布，点击查看更新`,
    })

    notification.on("click", () => {
      if (!this.windowManager) {
        app.emit("activate")
        return
      }

      const windows = this.windowManager.getAllWindows()
      let hasVisibleWindow = false

      for (const window of windows) {
        if (window.isDestroyed()) {
          continue
        }

        hasVisibleWindow = true
        if (window.isMinimized()) {
          window.restore()
        }
        if (!window.isVisible()) {
          window.show()
        }
        window.focus()
      }

      this.windowManager.broadcast(
        UPDATE_CHANNELS.openUpdatePage,
        {},
      )

      if (!hasVisibleWindow) {
        app.emit("activate")
      }
    })

    notification.show()
  }
}

const updateService = new UpdateService()

export { updateService }
