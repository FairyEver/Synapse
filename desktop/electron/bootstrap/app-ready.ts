import { dialog } from "electron"

import type { AutomationService } from "../services/automation"
import type { MobileGatewayService } from "../services/mobile-gateway-service"
import { accountService } from "../services/account-service"
import { editorInstallService } from "../services/editor-install-service"
import { installStatusCacheService } from "../services/install-status-cache-service"
import { liveConnectionService } from "../services/live-connection-service-instance"
import { LiveWebhookDeliveryHandler } from "../services/live-webhook-delivery-handler"
import { createMainLogger, logStore } from "../services/log-store"
import type { EventBus } from "../runtime/event-bus"
import type { IpcHandlerContext } from "../runtime/ipc/types"
import type { AuditSink, PermissionGuard } from "../runtime/security"
import type { WindowManager } from "../runtime/window"
import type { ProjectContainerRegistry } from "../runtime/project-container"
import { AGENT_RUNTIME_SERVICE_ID, type AgentRuntimeService } from "../services/agent-runtime"
import type { KnowledgeBaseStorageMigrationService } from "../services/knowledge-base/storage-migration-service"
import { createAccountExternalUrlOpener } from "./account-external-opener"
import { registerAgentArtifactProtocol } from "./agent-artifact-protocol"
import { attachActivateHandler } from "./app-events"
import { attachBeforeQuitHandler } from "./before-quit"
import { createIpcRegistry } from "./ipc-registry"
import { createMainWindow, type MainWindowState } from "./main-window"
import { buildServiceRegistry } from "./registry"
import { createSynapseSkillPreparedSourceProvider } from "../../app-capabilities/synapse-skill/main/prepared-source-provider"
import type { SynapseSkillService } from "../../app-capabilities/synapse-skill/main/service"
import { SYNAPSE_SKILL_SERVICE_ID } from "../../app-capabilities/synapse-skill/shared/capability"
import type { CoreDatabaseService } from "./descriptors"
import type { QuickInputService } from "../../app-capabilities/quick-input/main/service"

const logger = createMainLogger("bootstrap.app-ready")

/**
 * Guards the quick-input subscription below, in the same shape the App's own IPC
 * module uses to guard its renderer broadcast.
 *
 * That module resolves the service on every call wire, so its guard is load-bearing;
 * this one is not — `initializeReadyApp` runs once per launch — but it costs a line
 * and it means a second caller, if one ever appears, cannot end up with the sentences
 * being sent twice per edit.
 */
const quickPhraseSubscriptionWired = new WeakSet<QuickInputService>()

type InitializeReadyAppDeps = {
  focusOrCreateMainWindow: () => void
  isAppQuitting: () => boolean
  mainWindowState: MainWindowState
  setAllowAppQuit: (value: boolean) => void
  setProcessLevelCleanup?: (cleanup: (() => Promise<void>) | undefined) => void
  setWindowManager: (windowManager: WindowManager) => void
  setProtocolActionRouter?: (router: CoreDatabaseService["actionRouter"] | undefined) => void
  shouldCreateMainWindowBeforeProtocolHandling?: () => boolean
  startProtocolHandling: (
    prepareBeforeNonAuthRoutes: (handledAuthCallbacks: number) => Promise<void>,
  ) => Promise<number>
}

async function initializeReadyApp(deps: InitializeReadyAppDeps): Promise<void> {
  logger.info("Electron app is ready. Initializing IPC registry.")
  registerAgentArtifactProtocol()
  const registry = buildServiceRegistry({ trayShowOrCreate: deps.focusOrCreateMainWindow })
  deps.setProcessLevelCleanup?.(async () => {
    try {
      await registry.stopAll(3_000)
    } catch (error) {
      logger.error("Service registry stopAll() reported an error during fatal cleanup.", { error })
    }
    try {
      await logStore.dispose()
    } catch (error) {
      logger.error("logStore dispose failed during fatal cleanup.", { error })
    }
  })
  const ipcCtx: IpcHandlerContext = {
    moduleId: "main",
    logger,
    resolve: (serviceId) => registry.get(serviceId),
  }
  createIpcRegistry(ipcCtx)

  void installStatusCacheService.buildCache().catch((error) => {
    logger.warn("Install status cache initialization failed.", { error })
  })

  const result = await registry.startBlocking().catch(async (startErr) => {
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

  try {
    deps.setProtocolActionRouter?.(registry.get<CoreDatabaseService>("core.database").actionRouter)
  } catch {
    deps.setProtocolActionRouter?.(undefined)
  }

  try {
    const synapseSkillService = registry.get<SynapseSkillService>(SYNAPSE_SKILL_SERVICE_ID)
    editorInstallService.addPreparedSourceProvider(
      createSynapseSkillPreparedSourceProvider(synapseSkillService),
    )
  } catch (error) {
    logger.warn("Synapse Skill prepared source provider not installed.", {
      errorName: error instanceof Error ? error.name : typeof error,
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
  try {
    // Two directions, wired here so neither service has to know about the other:
    // cloud-delivered intents flow into the gateway, and the gateway hands finished
    // payloads back to the connection that owns the socket and the device identity.
    const mobileGateway = registry.get<MobileGatewayService>("core.mobile-gateway")
    liveConnectionService.setMobileIntentHandler({
      handle: (mobileClientInstanceId, intent) => mobileGateway.handleIntent(mobileClientInstanceId, intent),
      releaseClient: (mobileClientInstanceId) => mobileGateway.releaseClient(mobileClientInstanceId),
    })
    mobileGateway.setTransport({
      sendSummary: (draft) => void liveConnectionService.sendMobileSummary(draft),
      sendFrame: (mobileClientInstanceId, frame) => {
        void liveConnectionService.sendMobileFrame(mobileClientInstanceId, frame)
      },
      sendIntentResult: (mobileClientInstanceId, result) => {
        void liveConnectionService.sendMobileIntentResult(mobileClientInstanceId, result)
      },
      sendTransferProgress: (payload) => {
        void liveConnectionService.sendMobileTransferProgress(payload)
      },
      sendToolbar: (draft) => void liveConnectionService.sendMobileToolbar(draft),
      sendQuickPhrases: (draft) => void liveConnectionService.sendMobileQuickPhrases(draft),
    })
  } catch (error) {
    logger.warn("Mobile terminal gateway transport not installed.", {
      errorName: error instanceof Error ? error.name : typeof error,
    })
  }
  try {
    // The one edit to the user's 快捷输入 table that a phone has to hear about, and
    // the only place that can hear it: the quick-input App emits `changed` to its own
    // renderer, which is a window broadcast with nothing to do with the gateway. Its
    // own try/catch rather than the transport's above, so that an App unavailable at
    // this moment cannot cost the mobile gateway everything else it does.
    const mobileGateway = registry.get<MobileGatewayService>("core.mobile-gateway")
    const quickInputService = registry.get<QuickInputService>("core.quick-input")
    if (!quickPhraseSubscriptionWired.has(quickInputService)) {
      // The fingerprinted flush rather than the unconditional resend: the event fires
      // on every save, including one that rewrote the same sentence, so it means "look
      // again" — and an unchanged table must cost no traffic at all. The unconditional
      // resend is for a phone that has received nothing, which is `sync` and `attach`.
      quickInputService.events.on("changed", () => void mobileGateway.flushQuickPhrases())
      quickPhraseSubscriptionWired.add(quickInputService)
    }
  } catch (error) {
    logger.warn("Mobile quick phrase subscription not installed.", {
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
  const forEachAgentRuntime = async (
    action: (runtime: AgentRuntimeService) => void | Promise<void>,
  ): Promise<void> => {
    const projectContainers = registry.get<ProjectContainerRegistry>("core.project-containers")
    await Promise.all(projectContainers.list().map(async ({ projectId }) => {
      const container = projectContainers.peek(projectId)
      if (!container) return
      await action(container.get<AgentRuntimeService>(AGENT_RUNTIME_SERVICE_ID))
    }))
  }
  if (deps.shouldCreateMainWindowBeforeProtocolHandling?.() !== false) {
    createMainWindow({
      state: deps.mainWindowState,
      windowManager,
      isAppQuitting: deps.isAppQuitting,
      onRendererUnavailable: (rendererId) => forEachAgentRuntime(async (runtime) => {
        await runtime.interruptRendererTurns(rendererId)
      }),
      onRendererUnresponsive: (rendererId) => forEachAgentRuntime((runtime) =>
        runtime.pauseRendererDelivery(rendererId)),
      onRendererResponsive: (rendererId) => forEachAgentRuntime((runtime) =>
        runtime.resumeRendererDelivery(rendererId)),
    })
  }
  attachActivateHandler(() => {
    deps.focusOrCreateMainWindow()
    void accountService.retryOfflineNow()
  })

  await deps.startProtocolHandling(async (handledAuthCallbacks) => {
    if (handledAuthCallbacks === 0) {
      const state = await accountService.refreshFromStorage({ reason: "startup" })
      if (state !== lastLiveAccountState) liveConnectionService.handleAccountState(state)
    }
  })

  let knowledgeBaseStorageMigration: KnowledgeBaseStorageMigrationService | undefined
  try {
    knowledgeBaseStorageMigration = registry.get<KnowledgeBaseStorageMigrationService>(
      "knowledge-base.storage-migration-service",
    )
  } catch (error) {
    logger.warn("Knowledge Base storage migration quit gate unavailable.", {
      errorName: error instanceof Error ? error.name : typeof error,
    })
  }

  attachBeforeQuitHandler({
    state: deps.mainWindowState,
    registry,
    knowledgeBaseStorageMigration,
    setAllowQuit: deps.setAllowAppQuit,
    isAllowedToQuit: deps.isAppQuitting,
  })

  void registry.startBackground()
    .then((backgroundResult) => {
      for (const failure of backgroundResult.degraded) {
        logger.warn("Background service started in degraded state.", {
          id: failure.id,
          error: failure.error,
        })
      }
    })
    .catch((error) => {
      logger.error("Background service startup failed.", { error })
    })
}

export { initializeReadyApp }
