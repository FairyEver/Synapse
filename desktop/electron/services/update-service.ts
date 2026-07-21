import { app, Notification } from "electron"
import { CancellationToken } from "electron-updater"
import * as electronUpdater from "electron-updater"
import { z } from "zod"
import type {
  AppUpdater,
  ProgressInfo,
  UpdateDownloadedEvent,
  UpdateInfo,
} from "electron-updater"
import type {
  SynapseAppUpdateOpenRequest,
  SynapseAppUpdateState,
} from "../../src/types/update"
import type { WindowManager } from "../runtime/window"
import type { AuditSink, PermissionGuard } from "../runtime/security"
import { DESKTOP_UPDATE_INTENT_VERIFY_TIMEOUT_MS } from "../../config"
import { SYNAPSE_DESKTOP_DEPLOYMENT_CONFIG } from "../generated/deployment-config.generated"

// Update event channels for broadcasting state changes
const UPDATE_CHANNELS = {
  stateChanged: "synapse:app:update:operation:state_changed",
  openUpdatePage: "synapse:app:update:operation:open_update_page",
  openRequest: "synapse:app:update:operation:open_request",
} as const
import { createMainLogger } from "./log-store"

const autoUpdater: AppUpdater = electronUpdater.autoUpdater
const logger = createMainLogger("updater")

const AUTO_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000
const AUTO_CHECK_INITIAL_DELAY_MS = 60_000
const PAGE_ENTRY_CHECK_COOLDOWN_MS = 30_000
const UPDATE_ERROR_MESSAGE = "检查更新失败，请稍后再试。"
const UPDATE_DOWNLOAD_ERROR_MESSAGE = "下载更新失败，请重试。"
const updateIntentVerificationResponseSchema = z.object({
  authorized: z.literal(true),
}).strict()
const UPDATE_INTENT_VERIFICATION_ACTOR = {
  kind: "system",
  id: "desktop-update-intent",
} as const
const UPDATE_INTENT_VERIFICATION_SOURCE = "desktop.update-intent.verify"

type UpdateIntentVerificationSecurity = {
  readonly auditSink: AuditSink
  readonly permissionGuard: PermissionGuard
}

function recordUpdateIntentVerificationAudit(
  auditSink: AuditSink,
  resource: string,
  outcome: "allowed" | "denied" | "failed",
  metadata: Record<string, unknown> = {},
): void {
  auditSink.record({
    action: "network.connect",
    actor: UPDATE_INTENT_VERIFICATION_ACTOR,
    resource,
    outcome,
    metadata: {
      source: UPDATE_INTENT_VERIFICATION_SOURCE,
      ...metadata,
    },
  })
}

function isUpdateIntentVerificationTimeout(error: unknown): boolean {
  return error instanceof Error
    && (error.name === "AbortError" || error.name === "TimeoutError")
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
  private activeUpdateFlowId: number | null = null
  private availableUpdateInfo: UpdateInfo | null = null
  private cancelledDownloadFlowId: number | null = null
  private nextUpdateFlowId = 0
  private pageEntryCheckPromise: Promise<SynapseAppUpdateState> | null = null
  private lastPageEntryCheckCompletedAt: number | null = null
  private lastNotifiedVersion: string | null = null
  private autoCheckTimer: ReturnType<typeof setInterval> | null = null
  private windowManager: WindowManager | null = null
  private beforeInstallQuitHandler: (() => boolean | void) | null = null
  private updateIntentVerificationSecurity: UpdateIntentVerificationSecurity | null = null
  private pendingOpenRequest: SynapseAppUpdateOpenRequest | null = null
  private nextOpenRequestId = 0

  setWindowManager(windowManager: WindowManager): void {
    this.windowManager = windowManager
  }

  setBeforeInstallQuitHandler(handler: (() => boolean | void) | null): void {
    this.beforeInstallQuitHandler = handler
  }

  setUpdateIntentVerificationSecurity(security: UpdateIntentVerificationSecurity): void {
    this.updateIntentVerificationSecurity = security
  }

  publishUpdateOpenRequest(automatic: boolean): SynapseAppUpdateOpenRequest {
    const request = {
      id: this.nextOpenRequestId + 1,
      automatic,
    }
    this.nextOpenRequestId = request.id
    this.pendingOpenRequest = request
    this.windowManager?.broadcast(UPDATE_CHANNELS.openRequest, request)
    return { ...request }
  }

  getPendingOpenRequest(): SynapseAppUpdateOpenRequest | null {
    return this.pendingOpenRequest ? { ...this.pendingOpenRequest } : null
  }

  acknowledgeOpenRequest(id: number): void {
    if (this.pendingOpenRequest?.id === id) {
      this.pendingOpenRequest = null
    }
  }

  async verifyUpdateIntent(token: string): Promise<boolean> {
    const verificationUrl = `${SYNAPSE_DESKTOP_DEPLOYMENT_CONFIG.apiBaseUrl}/desktop/update-intent/verify`
    const security = this.updateIntentVerificationSecurity
    if (!security) {
      logger.warn("Update intent verification failed closed.", {
        outcome: "security-unavailable",
      })
      return false
    }

    const permission = await security.permissionGuard.check({
      action: "network.connect",
      actor: UPDATE_INTENT_VERIFICATION_ACTOR,
      context: { source: UPDATE_INTENT_VERIFICATION_SOURCE },
      resource: verificationUrl,
    })
    if (!permission.allowed) {
      recordUpdateIntentVerificationAudit(
        security.auditSink,
        verificationUrl,
        "denied",
        {
          reason: permission.reason,
          policyId: permission.policyId,
        },
      )
      logger.warn("Update intent verification failed closed.", {
        outcome: "permission-denied",
      })
      return false
    }

    let response: Response
    try {
      response = await fetch(
        verificationUrl,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ token }),
          signal: AbortSignal.timeout(DESKTOP_UPDATE_INTENT_VERIFY_TIMEOUT_MS),
        },
      )
    } catch (error) {
      recordUpdateIntentVerificationAudit(security.auditSink, verificationUrl, "failed")
      logger.warn("Update intent verification failed closed.", {
        outcome: isUpdateIntentVerificationTimeout(error)
          ? "timeout"
          : "service-unavailable",
      })
      return false
    }
    recordUpdateIntentVerificationAudit(
      security.auditSink,
      verificationUrl,
      "allowed",
      { status: response.status },
    )
    if (!response.ok) {
      logger.warn("Update intent verification failed closed.", {
        outcome: "rejected",
        status: response.status,
      })
      return false
    }
    try {
      const parsed = updateIntentVerificationResponseSchema.safeParse(await response.json())
      if (!parsed.success) {
        logger.warn("Update intent verification failed closed.", {
          outcome: "invalid-response",
        })
        return false
      }
      logger.info("Update intent verification succeeded.")
      return true
    } catch {
      logger.warn("Update intent verification failed closed.", {
        outcome: "invalid-response",
      })
      return false
    }
  }

  private clearDownloadTracking(cancellationToken?: CancellationToken, flowId?: number): void {
    if (cancellationToken && this.downloadCancellationToken !== cancellationToken) {
      return
    }
    this.downloadCancellationToken = null
    this.isCancellingDownload = false
    if (flowId === undefined || this.cancelledDownloadFlowId === flowId) {
      this.cancelledDownloadFlowId = null
    }
  }

  private beginUpdateFlow(mode: "manual" | "auto"): number {
    this.activeUpdateMode = mode
    this.activeUpdateFlowId = this.nextUpdateFlowId + 1
    this.nextUpdateFlowId = this.activeUpdateFlowId
    return this.activeUpdateFlowId
  }

  private clearUpdateFlow(mode?: "manual" | "auto", flowId?: number): void {
    if (
      (!mode || this.activeUpdateMode === mode)
      && (flowId === undefined || this.activeUpdateFlowId === flowId)
    ) {
      this.activeUpdateMode = null
      this.activeUpdateFlowId = null
    }
  }

  private isManualUpdateFlow(flowId?: number): boolean {
    return this.activeUpdateMode === "manual" && (flowId === undefined || this.activeUpdateFlowId === flowId)
  }

  private isAutoUpdateFlow(): boolean {
    return this.activeUpdateMode === "auto"
  }

  private isDownloadCancelledError(error: unknown, flowId?: number): boolean {
    return (flowId !== undefined && this.cancelledDownloadFlowId === flowId)
      || this.isCancellingDownload
      || (error instanceof Error && error.message === "cancelled")
  }

  private shouldHandleManualDownloadCancellation(flowId: number | null): flowId is number {
    return flowId !== null
      && this.isManualUpdateFlow(flowId)
      && (this.cancelledDownloadFlowId === null || this.cancelledDownloadFlowId === flowId)
  }

  async cancelDownload(): Promise<void> {
    if (this.downloadCancellationToken) {
      logger.info("Cancelling update download.")
      this.cancelledDownloadFlowId = this.activeUpdateFlowId
      this.isCancellingDownload = true
      this.downloadCancellationToken.cancel()
    }
    const cancelledFlowId = this.activeUpdateFlowId
    if (cancelledFlowId !== null) {
      this.clearUpdateFlow("manual", cancelledFlowId)
    }

    if (this.state.status === "downloading") {
      const availableVersion = this.availableUpdateInfo?.version ?? this.state.releaseVersion
      this.setState({
        status: availableVersion ? "available" : "idle",
        message: availableVersion ? `新版本 v${availableVersion} 可下载。` : "下载已取消。",
        error: null,
        downloadPercent: null,
        bytesPerSecond: null,
        transferredBytes: null,
        totalBytes: null,
        canCheck: !availableVersion && isUpdateSupportedInCurrentEnvironment(),
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

    let canQuit: boolean
    try {
      canQuit = this.beforeInstallQuitHandler?.() ?? true
    } catch (error) {
      logger.error("Failed to prepare app quit for update install.", error)
      throw new Error("准备安装更新失败，请稍后重试。", { cause: error })
    }
    if (!canQuit) {
      logger.info("Update install postponed because app quit is blocked.", {
        version: this.state.releaseVersion,
      })
      throw new Error("当前无法安全退出应用，请稍后再安装更新。")
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
        this.availableUpdateInfo = null
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
        downloadedFileBase: event.downloadedFile.split(/[/\\]/).pop(),
      })
      if (this.isManualUpdateFlow()) {
        this.handleUpdateDownloaded(event)
      }
    })

    autoUpdater.on("update-cancelled", (updateInfo) => {
      logger.info("Update download cancelled.", {
        version: updateInfo.version,
      })
      const flowId = this.activeUpdateFlowId
      if (this.shouldHandleManualDownloadCancellation(flowId)) {
        this.handleDownloadCancelled(updateInfo, flowId)
      }
    })

    autoUpdater.on("error", (error) => {
      logger.error("App updater reported an error.", error)
      if (this.isManualUpdateFlow()) {
        const flowId = this.activeUpdateFlowId
        if (this.isDownloadCancelledError(error, flowId ?? undefined)) {
          if (this.shouldHandleManualDownloadCancellation(flowId)) {
            this.handleDownloadCancelled(undefined, flowId)
          }
          return
        }

        if (this.state.status === "downloading" && flowId !== null) {
          this.handleDownloadError(flowId)
          return
        }

        this.handleError(error, flowId ?? undefined)
        return
      }

      if (this.isAutoUpdateFlow()) {
        this.handleAutoCheckError()
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
      || this.activeUpdateMode !== null
    ) {
      return this.getState()
    }

    const flowId = this.beginUpdateFlow("manual")
    this.availableUpdateInfo = null

    try {
      await autoUpdater.checkForUpdates()
      return this.getState()
    } catch (error) {
      if (this.isManualUpdateFlow(flowId)) {
        this.handleError(error, flowId)
      }
      return this.getState()
    }
  }

  async checkForUpdatesOnPageEnter(): Promise<SynapseAppUpdateState> {
    this.initialize()

    if (this.pageEntryCheckPromise) {
      return this.pageEntryCheckPromise
    }

    if (
      this.lastPageEntryCheckCompletedAt !== null
      && Date.now() - this.lastPageEntryCheckCompletedAt < PAGE_ENTRY_CHECK_COOLDOWN_MS
    ) {
      return this.getState()
    }

    const checkPromise = this.checkForUpdates()
    this.pageEntryCheckPromise = checkPromise

    try {
      return await checkPromise
    } finally {
      if (this.pageEntryCheckPromise === checkPromise) {
        this.pageEntryCheckPromise = null
        this.lastPageEntryCheckCompletedAt = Date.now()
      }
    }
  }

  downloadUpdate(): SynapseAppUpdateState {
    this.initialize()

    if (!isUpdateSupportedInCurrentEnvironment()) {
      return this.getState()
    }

    if (
      this.state.status === "downloading"
      || this.state.status === "downloaded"
      || this.activeUpdateMode !== null
    ) {
      return this.getState()
    }

    const updateInfo = this.availableUpdateInfo
    if (this.state.status !== "available" || !updateInfo) {
      throw new Error("没有可下载的新版本，请先检查更新。")
    }

    const flowId = this.beginUpdateFlow("manual")
    void this.downloadLatestUpdate(updateInfo, flowId).catch((error) => {
      if (this.isDownloadCancelledError(error, flowId)) {
        if (this.isManualUpdateFlow(flowId)) {
          this.handleDownloadCancelled(updateInfo, flowId)
        }
        return
      }
      if (!this.isManualUpdateFlow(flowId)) return

      logger.error("Failed to download update.", error)
      this.handleDownloadError(flowId)
    })

    return this.getState()
  }

  private handleUpdateAvailable(updateInfo: UpdateInfo): void {
    this.availableUpdateInfo = updateInfo
    this.setState({
      status: "available",
      message: `发现新版本 v${updateInfo.version}。`,
      error: null,
      releaseVersion: updateInfo.version,
      lastCheckedAt: new Date().toISOString(),
      downloadPercent: null,
      bytesPerSecond: null,
      transferredBytes: null,
      totalBytes: null,
      canCheck: false,
    })
    this.clearUpdateFlow("manual")
  }

  private async downloadLatestUpdate(updateInfo: UpdateInfo, flowId: number): Promise<void> {
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
    })

    try {
      await autoUpdater.downloadUpdate(cancellationToken)
    } catch (error) {
      if (this.isDownloadCancelledError(error, flowId)) {
        return
      }

      throw error
    } finally {
      this.clearDownloadTracking(cancellationToken, flowId)
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
    })
  }

  private handleUpdateDownloaded(event: UpdateDownloadedEvent): void {
    this.clearDownloadTracking()
    this.clearUpdateFlow("manual")

    this.setState({
      status: "downloaded",
      message: `新版本 v${event.version} 已下载。`,
      error: null,
      releaseVersion: event.version,
      downloadPercent: 100,
      transferredBytes: this.state.totalBytes ?? this.state.transferredBytes,
      totalBytes: this.state.totalBytes ?? this.state.transferredBytes,
      canCheck: false,
    })
  }

  private handleDownloadCancelled(updateInfo?: UpdateInfo, flowId?: number): void {
    this.clearDownloadTracking(undefined, flowId)
    this.clearUpdateFlow("manual", flowId)

    if (this.state.status !== "downloading" && this.state.status !== "available") {
      return
    }

    const availableVersion = this.availableUpdateInfo?.version ?? updateInfo?.version ?? this.state.releaseVersion
    this.setState({
      status: availableVersion ? "available" : "idle",
      message: availableVersion ? `新版本 v${availableVersion} 可下载。` : "下载已取消。",
      error: null,
      releaseVersion: availableVersion,
      downloadPercent: null,
      bytesPerSecond: null,
      transferredBytes: null,
      totalBytes: null,
      canCheck: !availableVersion && isUpdateSupportedInCurrentEnvironment(),
    })
  }

  private handleDownloadError(flowId: number): void {
    this.clearDownloadTracking(undefined, flowId)
    this.clearUpdateFlow("manual", flowId)

    this.setState({
      status: "available",
      message: UPDATE_DOWNLOAD_ERROR_MESSAGE,
      error: UPDATE_DOWNLOAD_ERROR_MESSAGE,
      downloadPercent: null,
      bytesPerSecond: null,
      transferredBytes: null,
      totalBytes: null,
      canCheck: false,
    })
  }

  private handleError(_error: unknown, flowId?: number): void {
    this.clearDownloadTracking(undefined, flowId)
    this.clearUpdateFlow(undefined, flowId)
    this.availableUpdateInfo = null

    this.setState({
      status: "error",
      message: UPDATE_ERROR_MESSAGE,
      error: UPDATE_ERROR_MESSAGE,
      downloadPercent: null,
      bytesPerSecond: null,
      transferredBytes: null,
      totalBytes: null,
      canCheck: isUpdateSupportedInCurrentEnvironment(),
    })
  }

  private handleAutoCheckError(): void {
    this.clearDownloadTracking()
    this.clearUpdateFlow("auto")
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
        this.handleAutoCheckError()
      })
    }

    setTimeout(runAutoCheck, AUTO_CHECK_INITIAL_DELAY_MS)
    this.autoCheckTimer = setInterval(runAutoCheck, AUTO_CHECK_INTERVAL_MS)
  }

  private handleAutoCheckUpdateAvailable(updateInfo: UpdateInfo): void {
    this.availableUpdateInfo = updateInfo
    this.setState({
      status: "available",
      message: `发现新版本 v${updateInfo.version}。`,
      error: null,
      releaseVersion: updateInfo.version,
      lastCheckedAt: new Date().toISOString(),
      downloadPercent: null,
      bytesPerSecond: null,
      transferredBytes: null,
      totalBytes: null,
      canCheck: false,
    })
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

      if (!hasVisibleWindow) {
        this.windowManager.open("main")
      }

      this.windowManager.broadcast(
        UPDATE_CHANNELS.openUpdatePage,
        {},
      )
    })

    notification.show()
  }
}

const updateService = new UpdateService()

export { updateService }
