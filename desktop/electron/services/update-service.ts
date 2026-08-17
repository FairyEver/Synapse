import { app, autoUpdater as nativeAutoUpdater, Notification } from "electron"
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
import type { UpdateInstallRecoveryEntryV1 } from "../runtime/data-repo"
import type {
  UpdateInstallRecoveryDecision,
  UpdateInstallRecoveryService,
} from "./update-install-recovery-service"
import {
  DESKTOP_UPDATE_INSTALL_HANDOFF_TIMEOUT_MS,
  DESKTOP_UPDATE_INTENT_VERIFY_TIMEOUT_MS,
  DESKTOP_UPDATE_RELEASE_BASE_URL,
  DESKTOP_UPDATE_SHIPIT_START_TIMEOUT_MS,
} from "../../config"
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
const UPDATE_INSTALL_HANDOFF_TIMEOUT_MESSAGE = "无法启动更新安装程序，请重新打开 Synapse 后重试。"
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

type InstallQuitHandlers = {
  readonly allowQuit: () => void
  readonly canQuit: () => boolean | void
}

type InstallRecoveryController = Pick<
  UpdateInstallRecoveryService,
  | "ensureShipItStarted"
  | "markManualRequired"
  | "reconcile"
  | "recordInstallAttempt"
  | "restoreState"
  | "updatePreparedTarget"
>

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
    installRecovery: null,
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
  private activeUpdateMode: "manual" | "auto" | "recovery" | null = null
  private activeUpdateFlowId: number | null = null
  private availableUpdateInfo: UpdateInfo | null = null
  private cancelledDownloadFlowId: number | null = null
  private nextUpdateFlowId = 0
  private pageEntryCheckPromise: Promise<SynapseAppUpdateState> | null = null
  private lastPageEntryCheckCompletedAt: number | null = null
  private lastNotifiedVersion: string | null = null
  private autoCheckTimer: ReturnType<typeof setInterval> | null = null
  private windowManager: WindowManager | null = null
  private installQuitHandlers: InstallQuitHandlers | null = null
  private installRecoveryService: InstallRecoveryController | null = null
  private macInstallHandoffTimedOut = false
  private macInstallHandoffPending = false
  private updateIntentVerificationSecurity: UpdateIntentVerificationSecurity | null = null
  private pendingOpenRequest: SynapseAppUpdateOpenRequest | null = null
  private nextOpenRequestId = 0

  setWindowManager(windowManager: WindowManager): void {
    this.windowManager = windowManager
  }

  setInstallQuitHandlers(handlers: InstallQuitHandlers | null): void {
    this.installQuitHandlers = handlers
  }

  setInstallRecoveryService(service: InstallRecoveryController | null): void {
    this.installRecoveryService = service
  }

  isInstallHandoffPending(): boolean {
    return this.macInstallHandoffPending
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

  private beginUpdateFlow(mode: "manual" | "auto" | "recovery"): number {
    this.activeUpdateMode = mode
    this.activeUpdateFlowId = this.nextUpdateFlowId + 1
    this.nextUpdateFlowId = this.activeUpdateFlowId
    return this.activeUpdateFlowId
  }

  private clearUpdateFlow(mode?: "manual" | "auto" | "recovery", flowId?: number): void {
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

  private isRecoveryUpdateFlow(flowId?: number): boolean {
    return this.activeUpdateMode === "recovery"
      && (flowId === undefined || this.activeUpdateFlowId === flowId)
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
    if (process.platform === "darwin" && this.macInstallHandoffTimedOut) {
      throw new Error("请重新打开 Synapse 后再安装更新。")
    }

    logger.info("Installing downloaded update.", {
      version: this.state.releaseVersion,
    })

    let canQuit: boolean
    try {
      canQuit = this.installQuitHandlers?.canQuit() ?? true
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

    const targetVersion = this.state.releaseVersion
    if (!targetVersion) {
      throw new Error("更新版本信息不可用，请重新检查更新。")
    }

    let previousRecoveryState: UpdateInstallRecoveryEntryV1 | null = null
    if (process.platform === "darwin" && this.installRecoveryService) {
      previousRecoveryState = await this.installRecoveryService.recordInstallAttempt(
        targetVersion,
        resolveManualInstallerUrl(this.availableUpdateInfo),
      )
    }

    if (process.platform !== "darwin") {
      this.installQuitHandlers?.allowQuit()
      autoUpdater.quitAndInstall(false, true)
      return
    }

    await this.handoffMacUpdate(previousRecoveryState)
  }

  private async handoffMacUpdate(
    previousRecoveryState: UpdateInstallRecoveryEntryV1 | null,
  ): Promise<void> {
    this.macInstallHandoffPending = true
    await new Promise<void>((resolve, reject) => {
      const handoffStartedAt = Date.now()
      let settled = false
      const finish = (callback: () => void) => {
        if (settled) return
        settled = true
        this.macInstallHandoffPending = false
        clearTimeout(timeout)
        nativeAutoUpdater.removeListener("before-quit-for-update", handleBeforeQuitForUpdate)
        callback()
      }
      const handleBeforeQuitForUpdate = () => {
        clearTimeout(timeout)
        logger.info("macOS native updater requested app quit.", {
          elapsedMs: Date.now() - handoffStartedAt,
          targetVersion: this.state.releaseVersion,
        })
        void this.verifyAndCompleteMacUpdateHandoff(previousRecoveryState, () => !settled).then(
          () => finish(() => {
            try {
              app.quit()
              resolve()
            } catch (error) {
              reject(error)
            }
          }),
          (error) => finish(() => reject(error)),
        )
      }
      const timeout = setTimeout(() => {
        logger.warn("macOS native update handoff timed out.", {
          elapsedMs: Date.now() - handoffStartedAt,
          targetVersion: this.state.releaseVersion,
        })
        finish(() => {
          void this.rollbackTimedOutInstall(previousRecoveryState).then(() => {
            reject(new Error(UPDATE_INSTALL_HANDOFF_TIMEOUT_MESSAGE))
          }, (error) => {
            reject(new Error(UPDATE_INSTALL_HANDOFF_TIMEOUT_MESSAGE, { cause: error }))
          })
        })
      }, DESKTOP_UPDATE_INSTALL_HANDOFF_TIMEOUT_MS)

      nativeAutoUpdater.once("before-quit-for-update", handleBeforeQuitForUpdate)
      try {
        logger.info("Requesting macOS native update handoff.", {
          targetVersion: this.state.releaseVersion,
        })
        autoUpdater.quitAndInstall(false, true)
      } catch (error) {
        logger.error("macOS native update handoff failed synchronously.", error)
        finish(() => {
          void this.restoreInstallRecoveryState(previousRecoveryState).then(() => reject(error), reject)
        })
      }
    })
  }

  private async verifyAndCompleteMacUpdateHandoff(
    previousRecoveryState: UpdateInstallRecoveryEntryV1 | null,
    isActive: () => boolean,
  ): Promise<void> {
    const abortController = new AbortController()
    try {
      const shipItStarted = await withHardTimeout(
        this.installRecoveryService?.ensureShipItStarted(abortController.signal) ?? Promise.resolve(false),
        DESKTOP_UPDATE_SHIPIT_START_TIMEOUT_MS,
        abortController,
      )
      if (!isActive()) return
      if (!shipItStarted) {
        throw new Error("ShipIt launch service was registered but did not start.")
      }
      this.installQuitHandlers?.allowQuit()
      logger.info("macOS update handoff verified; quitting for installation.", {
        targetVersion: this.state.releaseVersion,
      })
    } catch (error) {
      if (!isActive()) return
      logger.error("macOS ShipIt startup verification failed.", error)
      await this.rollbackTimedOutInstall(previousRecoveryState)
      throw new Error(UPDATE_INSTALL_HANDOFF_TIMEOUT_MESSAGE, { cause: error })
    }
  }

  private async rollbackTimedOutInstall(
    previousRecoveryState: UpdateInstallRecoveryEntryV1 | null,
  ): Promise<void> {
    await this.restoreInstallRecoveryState(previousRecoveryState)
    this.macInstallHandoffTimedOut = true
    const message = UPDATE_INSTALL_HANDOFF_TIMEOUT_MESSAGE
    this.setState({
      status: "downloaded",
      message,
      error: message,
      canCheck: false,
    })
  }

  private async restoreInstallRecoveryState(
    previousRecoveryState: UpdateInstallRecoveryEntryV1 | null,
  ): Promise<void> {
    if (previousRecoveryState && this.installRecoveryService) {
      await this.installRecoveryService.restoreState(previousRecoveryState)
    }
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

    if (process.platform === "darwin") {
      nativeAutoUpdater.on("update-downloaded", () => {
        logger.info("macOS native updater finished staging the update.", {
          activeUpdateMode: this.activeUpdateMode,
          currentVersion: this.state.currentVersion,
          targetVersion: this.state.releaseVersion,
        })
      })
      nativeAutoUpdater.on("error", (error) => {
        logger.error("macOS native updater reported an error.", error)
      })
    }

    autoUpdater.on("checking-for-update", () => {
      logger.info("Checking for updates.")
      if (this.isManualUpdateFlow() || this.isRecoveryUpdateFlow()) {
        this.setState({
          status: "checking",
          message: this.isRecoveryUpdateFlow() ? "正在修复更新..." : "正在检查更新...",
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
      } else if (this.isRecoveryUpdateFlow()) {
        void this.handleRecoveryUpdateAvailable(updateInfo)
      } else if (this.isManualUpdateFlow()) {
        this.handleUpdateAvailable(updateInfo)
      }
    })

    autoUpdater.on("update-not-available", (updateInfo) => {
      logger.info("No update available.", {
        version: updateInfo.version,
      })
      if (this.isRecoveryUpdateFlow()) {
        void this.enterManualRecovery()
        return
      }
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
      if (this.isManualUpdateFlow() || this.isRecoveryUpdateFlow()) {
        this.handleDownloadProgress(progressInfo)
      }
    })

    autoUpdater.on("update-downloaded", (event) => {
      logger.info("Update downloaded.", {
        version: event.version,
        downloadedFileBase: event.downloadedFile.split(/[/\\]/).pop(),
      })
      if (this.isRecoveryUpdateFlow()) {
        this.handleRecoveryUpdateDownloaded(event)
      } else if (this.isManualUpdateFlow()) {
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
        return
      }

      if (this.isRecoveryUpdateFlow()) {
        void this.enterManualRecovery()
      }
    })

    logger.info("App updater initialized.", {
      autoDownload: autoUpdater.autoDownload,
      autoInstallOnAppQuit: autoUpdater.autoInstallOnAppQuit,
      currentVersion: this.state.currentVersion,
      platform: process.platform,
    })
  }

  getState(): SynapseAppUpdateState {
    this.initialize()
    return cloneState(this.state)
  }

  async initializeInstallRecovery(): Promise<void> {
    this.initialize()
    if (process.platform !== "darwin" || !this.installRecoveryService) return

    let decision: UpdateInstallRecoveryDecision
    try {
      decision = await this.installRecoveryService.reconcile(app.getVersion())
    } catch (error) {
      logger.error("Failed to reconcile the pending update install.", error)
      return
    }
    if (decision.kind === "none") return

    if (decision.kind === "manual") {
      this.applyManualRecovery(decision)
      this.publishUpdateOpenRequest(false)
      return
    }

    this.setState({
      status: "checking",
      message: "正在修复更新...",
      error: null,
      releaseVersion: decision.targetVersion,
      downloadPercent: null,
      bytesPerSecond: null,
      transferredBytes: null,
      totalBytes: null,
      canCheck: false,
      installRecovery: {
        phase: "repairing",
        targetVersion: decision.targetVersion,
        manualInstallerUrl: decision.manualInstallerUrl,
      },
    })
    this.beginUpdateFlow("recovery")
    this.publishUpdateOpenRequest(false)
    try {
      await autoUpdater.checkForUpdates()
    } catch (error) {
      logger.error("Failed to redownload the update after repairing ShipIt.", error)
      await this.enterManualRecovery()
    }
  }

  startInstallRecoveryInBackground(): void {
    this.initialize()
    void this.initializeInstallRecovery().catch((error) => {
      logger.error("Background update install recovery failed.", error)
    }).finally(() => {
      this.startAutoCheck()
    })
  }

  async checkForUpdates(): Promise<SynapseAppUpdateState> {
    this.initialize()

    if (!isUpdateSupportedInCurrentEnvironment()) {
      return this.getState()
    }

    if (this.state.installRecovery?.phase === "manual-required") {
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

  private async handleRecoveryUpdateAvailable(updateInfo: UpdateInfo): Promise<void> {
    const flowId = this.activeUpdateFlowId
    if (flowId === null || !this.isRecoveryUpdateFlow(flowId) || !this.installRecoveryService) return

    const manualInstallerUrl = resolveManualInstallerUrl(updateInfo)
    try {
      await this.installRecoveryService.updatePreparedTarget(updateInfo.version, manualInstallerUrl)
      if (!this.isRecoveryUpdateFlow(flowId)) return
      this.availableUpdateInfo = updateInfo
      this.setState({
        releaseVersion: updateInfo.version,
        installRecovery: {
          phase: "repairing",
          targetVersion: updateInfo.version,
          manualInstallerUrl,
        },
      })
      await this.downloadLatestUpdate(updateInfo, flowId)
    } catch (error) {
      logger.error("Failed to redownload the repaired update.", error)
      if (this.isRecoveryUpdateFlow(flowId)) {
        await this.enterManualRecovery()
      }
    }
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
      message: this.isRecoveryUpdateFlow() ? "正在重新下载更新..." : "正在下载更新...",
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

  private handleRecoveryUpdateDownloaded(event: UpdateDownloadedEvent): void {
    const recovery = this.state.installRecovery
    this.clearDownloadTracking()
    this.clearUpdateFlow("recovery")
    this.setState({
      status: "downloaded",
      message: `新版本 v${event.version} 已重新下载，请点击安装。`,
      error: null,
      releaseVersion: event.version,
      downloadPercent: 100,
      transferredBytes: this.state.totalBytes ?? this.state.transferredBytes,
      totalBytes: this.state.totalBytes ?? this.state.transferredBytes,
      canCheck: false,
      installRecovery: {
        phase: "retry-ready",
        targetVersion: event.version,
        manualInstallerUrl: recovery?.manualInstallerUrl ?? resolveManualInstallerUrl(this.availableUpdateInfo),
      },
    })
  }

  private async enterManualRecovery(): Promise<void> {
    this.clearDownloadTracking()
    this.clearUpdateFlow("recovery")
    if (!this.installRecoveryService) return
    try {
      const decision = await this.installRecoveryService.markManualRequired()
      if (decision.kind === "manual") {
        this.applyManualRecovery(decision)
      }
    } catch (error) {
      logger.error("Failed to persist manual update recovery state.", error)
    }
  }

  private applyManualRecovery(
    decision: Extract<UpdateInstallRecoveryDecision, { kind: "manual" }>,
  ): void {
    const message = "自动安装未完成，请下载安装包。"
    this.setState({
      status: "error",
      message,
      error: message,
      releaseVersion: decision.targetVersion,
      downloadPercent: null,
      bytesPerSecond: null,
      transferredBytes: null,
      totalBytes: null,
      canCheck: false,
      installRecovery: {
        phase: "manual-required",
        targetVersion: decision.targetVersion,
        manualInstallerUrl: decision.manualInstallerUrl,
      },
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

function withHardTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  abortController: AbortController,
): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | null = null
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => {
      abortController.abort()
      reject(new Error(`Operation timed out after ${String(timeoutMs)}ms.`))
    }, timeoutMs)
  })
  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timeout) clearTimeout(timeout)
  })
}

const updateService = new UpdateService()

function resolveManualInstallerUrl(updateInfo: UpdateInfo | null): string | null {
  if (!updateInfo) return null
  const dmgFile = updateInfo.files.find((file) => {
    try {
      return new URL(file.url, DESKTOP_UPDATE_RELEASE_BASE_URL).pathname.endsWith(".dmg")
    } catch {
      return false
    }
  })
  if (!dmgFile) return null

  try {
    const releaseBaseUrl = new URL(DESKTOP_UPDATE_RELEASE_BASE_URL)
    const installerUrl = new URL(dmgFile.url, releaseBaseUrl)
    const expectedVersionSegment = `/v${updateInfo.version}/`
    if (
      installerUrl.protocol !== "https:"
      || installerUrl.host !== releaseBaseUrl.host
      || installerUrl.username !== ""
      || installerUrl.password !== ""
      || !installerUrl.pathname.startsWith(expectedVersionSegment)
      || !installerUrl.pathname.endsWith(".dmg")
    ) {
      return null
    }
    return installerUrl.toString()
  } catch {
    return null
  }
}

export { updateService }
