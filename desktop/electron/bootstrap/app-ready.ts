import { dialog } from "electron"

import type { AutomationService } from "../services/automation"
import { accountService } from "../services/account-service"
import { installStatusCacheService } from "../services/install-status-cache-service"
import { liveConnectionService } from "../services/live-connection-service-instance"
import { LiveWebhookDeliveryHandler } from "../services/live-webhook-delivery-handler"
import { createMainLogger } from "../services/log-store"
import type { EventBus } from "../runtime/event-bus"
import type { IpcHandlerContext } from "../runtime/ipc/types"
import type { AuditSink, PermissionGuard } from "../runtime/security"
import type { WindowManager } from "../runtime/window"
import { createAccountExternalUrlOpener } from "./account-external-opener"
import { attachActivateHandler } from "./app-events"
import { attachBeforeQuitHandler } from "./before-quit"
import { createIpcRegistry } from "./ipc-registry"
import { createMainWindow, type MainWindowState } from "./main-window"
import { buildServiceRegistry } from "./registry"

const logger = createMainLogger("bootstrap.app-ready")

type InitializeReadyAppDeps = {
  focusOrCreateMainWindow: () => void
  isAppQuitting: () => boolean
  mainWindowState: MainWindowState
  setAllowAppQuit: (value: boolean) => void
  setWindowManager: (windowManager: WindowManager) => void
  startProtocolHandling: (
    prepareBeforeNonAuthRoutes: (handledAuthCallbacks: number) => Promise<void>,
  ) => Promise<number>
}

async function initializeReadyApp(deps: InitializeReadyAppDeps): Promise<void> {
  logger.info("Electron app is ready. Initializing IPC registry.")
  const registry = buildServiceRegistry({ trayShowOrCreate: deps.focusOrCreateMainWindow })
  const ipcCtx: IpcHandlerContext = {
    moduleId: "main",
    logger,
    resolve: (serviceId) => registry.get(serviceId),
  }
  createIpcRegistry(ipcCtx)

  void installStatusCacheService.buildCache().catch((error) => {
    logger.warn("Install status cache initialization failed.", { error })
  })

  const result = await registry.startAll().catch(async (startErr) => {
    await registry.stopAll(10_000).catch((stopErr) => {
      logger.error("stopAll failed during fatal startup cleanup.", { error: stopErr })
    })
    throw startErr
  })
  if (result.degraded.length > 0) {
    for (const failure of result.degraded) {
      logger.warn("Service started in degraded state.", {
        id: failure.id,
        error: failure.error,
      })
    }
    void dialog.showMessageBox({
      type: "warning",
      title: "部分功能不可用",
      message: "部分服务启动失败。",
      detail: result.degraded.map((failure) => `${failure.id}: ${failure.error?.message ?? "未知错误"}`).join("\n"),
      buttons: ["知道了"],
    })
  }

  const eventBus = registry.get<EventBus>("core.event-bus")
  accountService.setEventBus(eventBus)
  liveConnectionService.setEventBus(eventBus)
  try {
    liveConnectionService.setWebhookDeliveryHandler(new LiveWebhookDeliveryHandler({
      automation: registry.get<AutomationService>("core.automation"),
    }))
  } catch (error) {
    logger.warn("Live webhook delivery handler not installed.", {
      errorName: error instanceof Error ? error.name : typeof error,
    })
  }

  let lastLiveAccountState: unknown
  accountService.onStateChanged((state) => {
    lastLiveAccountState = state
    liveConnectionService.handleAccountState(state)
  })
  accountService.setExternalUrlOpener(createAccountExternalUrlOpener({
    auditSink: registry.get<AuditSink>("core.audit-sink"),
    permissionGuard: registry.get<PermissionGuard>("core.permission-guard"),
  }))

  const windowManager = registry.get<WindowManager>("core.window-manager")
  deps.setWindowManager(windowManager)
  createMainWindow({
    state: deps.mainWindowState,
    windowManager,
    isAppQuitting: deps.isAppQuitting,
  })
  attachActivateHandler(() => {
    deps.focusOrCreateMainWindow()
    void accountService.retryOfflineNow()
  })

  await deps.startProtocolHandling(async (handledAuthCallbacks) => {
    if (handledAuthCallbacks === 0) {
      const state = await accountService.refreshFromStorage()
      if (state !== lastLiveAccountState) liveConnectionService.handleAccountState(state)
    }
  })

  attachBeforeQuitHandler({
    state: deps.mainWindowState,
    registry,
    setAllowQuit: deps.setAllowAppQuit,
    isAllowedToQuit: deps.isAppQuitting,
  })
}

export { initializeReadyApp }
