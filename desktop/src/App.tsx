import { useMainNavigation } from "@/app-shell/hooks/use-main-navigation"
import type { MainNavigationInput } from "@/modules/apps/main-navigation"
import { AgentShareRenderHost } from "@/modules/agent/share/render-host"
import { runAppNavigation } from "@/app-shell/navigation-guard"
import { useCallback, useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import { isAccountUiVisible } from "@/app-shell/account-ui-visibility"
import { AppShellActions } from "@/app-shell/components/app-shell-actions"
import { AppShellDock } from "@/app-shell/components/app-shell-dock"
import { AppShellUpdateIndicator } from "@/app-shell/components/app-shell-update-indicator"
import { IdentityGate } from "@/app-shell/components/identity-gate"
import { KnowledgeBaseStorageMigrationDialog } from "@/app-shell/components/knowledge-base-storage-migration-dialog"
import { AppShellLayout } from "@/app-shell/components/app-shell-layout"
import { useAppConfig } from "@/app-shell/config"
import { subscribeContentOpenRequest, type ContentOpenRequest } from "@/app-shell/content-navigation"
import { subscribeOpenTerminalSession } from "@/app-shell/terminal-navigation"
import { ensureBodyInteractable } from "@/app-shell/dialog-navigate"
import { useKnowledgeBaseStorageMigration } from "@/app-shell/hooks/use-knowledge-base-storage-migration"
import { useCurrentRepoProfile } from "@/app-shell/identity-context"
import { createRendererLogger } from "@/app-shell/logging"
import { updateDiagnosticContext } from "@/lib/diagnostic-context"
import { track, updateTrackingContext } from "@/lib/ui-tracking"
import {
  type OpenAgentSessionPayload,
  publishActiveAppTab,
  requestOpenSettingsAccount,
  requestOpenSettingsAbout,
  requestOpenSettingsDock,
  subscribeOpenAgentSession,
  subscribeOpenSettingsTab,
} from "@/app-shell/navigation"
import { useWatchNextAgentSession } from "@/app-shell/use-watch-next-agent-session"
import { useUpdateOpenRequest, type UpdateOpenRequestControls } from "@/hooks/use-update-open-request"
import {
  useAgentConversationOpenRequest,
  type AgentConversationOpenRequestControls,
} from "@/hooks/use-agent-conversation-open-request"
import { isWorkflowEntryVisible } from "@/app-shell/workflow-entry-visibility"
import type { SynapseAppUpdateOpenRequest } from "@/types/update"
import {
  useActiveRepository,
  useHasRepositories,
  useRepositoryManager,
  useRepositoryState,
} from "@/app-shell/use-repository-manager"
import { WORKFLOW_ENTRY_CHEAT_CODE_NAME } from "@/lib/cheat-codes/names"
import { getSynapseBridge } from "@/lib/electron-bridge"
import { ErrorBoundary } from "@/components/error-boundary"
import { parseAgentConversationWindowRequest } from "@/lib/agent-conversation-window"
import { parseContentWindowRequest } from "@/lib/content-window"
import { ContentWindowPage } from "@/modules/content/components/content-window-page"
import { AgentConversationWindowPage } from "@/modules/agent/components/agent-conversation-window-page"
import {
  resolveDefaultDockAppId,
} from "@/modules/apps/dock"
import { useCloudDock } from "@/modules/custom-apps/use-cloud-dock"
import { getSystemAppManifest, listSystemApps } from "@/modules/apps/registry"
import { isSystemAppEntryVisible } from "@/modules/apps/visibility"
import { EmbeddedSystemAppShell } from "@/modules/apps/components/embedded-system-app-shell"
import { AppSwitchTransition } from "@/modules/apps/components/app-switch-transition"
import { SystemAppContent } from "@/modules/apps/components/system-app-content"
import { isSystemAppId, type SynapseAppId } from "@/modules/apps/types"
import { CustomAppsProvider, useCustomApps } from "@/modules/custom-apps/context"
import { shouldReturnToLauncher } from "@/modules/custom-apps/app-availability"
import { NativeSurfaceOcclusionProvider } from "@/modules/custom-apps/native-surface-occlusion"
import { IframeCustomAppContent } from "@/modules/custom-apps/iframe-app-content"
import type { CustomAppId } from "@synapse/shared"
import { SynapseSkillAutoUpdateHost } from "../app-capabilities/synapse-skill/renderer/auto-update"

type ActiveAppId = SynapseAppId
type ActiveAppChangeSource = "navigation" | "shortcut" | "notification" | "sync-status" | "cheat-code"

const logger = createRendererLogger("app")

function MainApp() {
  return (
    <NativeSurfaceOcclusionProvider>
      <CustomAppsProvider>
        <MainAppInner />
      </CustomAppsProvider>
    </NativeSurfaceOcclusionProvider>
  )
}

function MainAppInner() {
  const { config } = useAppConfig()
  const activeRepository = useActiveRepository()
  const hasRepositories = useHasRepositories()
  const manager = useRepositoryManager()
  const initialWorkflowEntryVisible = isWorkflowEntryVisible({})
  const initialDockAppId = resolveDefaultDockAppId(listSystemApps(), {
    dockAppIds: config.global.dockAppIds,
    workflowEntryVisible: initialWorkflowEntryVisible,
  })
  const [activeAppId, setActiveAppIdRaw] = useState<ActiveAppId>(() => hasRepositories ? initialDockAppId : "agent")
  const [pendingAgentSession, setPendingAgentSession] =
    useState<OpenAgentSessionPayload | null>(null)
  const pendingAgentOpenControlsRef = useRef<{
    readonly requestId: number
    readonly controls: AgentConversationOpenRequestControls
  } | null>(null)
  const [pendingAppContentOpenRequest, setPendingAppContentOpenRequest] =
    useState<ContentOpenRequest | null>(null)
  const [launcherResetKey, setLauncherResetKey] = useState(0)
  const [workflowEntryVisible, setWorkflowEntryVisible] = useState(initialWorkflowEntryVisible)
  const dock = useCloudDock({ workflowEntryVisible })
  const customApps = useCustomApps()
  const knowledgeBaseStorageMigration = useKnowledgeBaseStorageMigration()

  // 检查是否需要显示空状态页面
  const hasNoRepositories = !hasRepositories
  const activeRepositoryState = useRepositoryState(activeRepository?.uuid ?? "")
  const isActiveRepositoryMissing = activeRepositoryState?.status === "missing" || activeRepositoryState?.status === "inaccessible"
  const { currentRepoProfileState } = useCurrentRepoProfile()
  const repoOnboardingActive = Boolean(
    activeRepository
    && activeRepositoryState?.status === "ready"
    && currentRepoProfileState?.status === "needs-onboarding",
  )

  const activeAppIdRef = useRef(activeAppId)
  activeAppIdRef.current = activeAppId

  useEffect(() => {
    updateDiagnosticContext({
      activeRepositoryUuid: activeRepository?.uuid,
      activeAppId,
      windowType: "main",
    })
    updateTrackingContext({ moduleId: activeAppId, windowType: "main" })
  }, [activeAppId, activeRepository?.uuid])

  const selectApp = useCallback(
    (nextAppId: ActiveAppId, source: ActiveAppChangeSource) => {
      const previousAppId = activeAppIdRef.current
      if (previousAppId !== nextAppId) {
        logger.info("Active system app changed.", {
          from: previousAppId,
          to: nextAppId,
          source,
        })
        track({
          component: "app-navigation",
          name: "active-system-app-changed",
          action: "select",
          eventKey: `navigation.${nextAppId}`,
          category: "navigation",
          value: nextAppId,
          metadata: { source },
        })
      }
      setActiveAppIdRaw(nextAppId)
    },
    [],
  )

  const navigateMain = useCallback((destination: MainNavigationInput, apply: () => boolean) =>
    runAppNavigation(() => {
      if (!apply()) return
      if (destination.appId !== "message-center") {
        ensureBodyInteractable()
        selectApp(destination.appId, "notification")
      }
    }), [selectApp])
  const mainNavigation = useMainNavigation(navigateMain)
  const { pending, open: openMainTarget, complete: completeMainTarget, discard: discardMainTarget } = mainNavigation
  const setActiveAppId = useCallback((id: ActiveAppId, source: ActiveAppChangeSource) => {
    void runAppNavigation(() => {
      if (activeAppIdRef.current !== id) discardMainTarget()
      selectApp(id, source)
    })
  }, [discardMainTarget, selectApp])
  const completeTargetById = useCallback((requestId: string) => {
    if (pending && "target" in pending && typeof pending.target === "object"
      && pending.target && "requestId" in pending.target && pending.target.requestId === requestId) {
      completeMainTarget(pending)
    }
  }, [pending, completeMainTarget])
  const completeMainTargetWithoutId = useCallback(() => {
    if (pending) completeMainTarget(pending)
  }, [pending, completeMainTarget])

  useEffect(() => {
    if (!hasRepositories && activeAppIdRef.current === initialDockAppId) {
      setActiveAppId("agent", "navigation")
    }
  }, [hasRepositories, initialDockAppId, setActiveAppId])

  useEffect(() => {
    const bridge = getSynapseBridge()

    if (!bridge) {
      setWorkflowEntryVisible(isWorkflowEntryVisible({}))
      return
    }

    let cancelled = false

    void bridge.cheatCodes.getStates([WORKFLOW_ENTRY_CHEAT_CODE_NAME])
      .then((states) => {
        if (!cancelled) {
          setWorkflowEntryVisible(isWorkflowEntryVisible(states))
        }
      })
      .catch((error) => {
        logger.error("Failed to read workflow entry cheat code state.", error)
        if (!cancelled) {
          setWorkflowEntryVisible(isWorkflowEntryVisible({}))
        }
      })

    const unsubscribe = bridge.cheatCodes.onStateChanged((state) => {
      if (state.name === WORKFLOW_ENTRY_CHEAT_CODE_NAME) {
        setWorkflowEntryVisible(isWorkflowEntryVisible({
          [WORKFLOW_ENTRY_CHEAT_CODE_NAME]: state.active,
        }))
      }
    })

    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [])

  useEffect(() => {
    const activeApp = isSystemAppId(activeAppId) ? getSystemAppManifest(activeAppId) : null
    if (activeApp && !isSystemAppEntryVisible(activeApp, { workflowEntryVisible })) {
      setActiveAppId(resolveDefaultDockAppId(listSystemApps(), {
        dockAppIds: dock.dockAppIds.filter(isSystemAppId),
        workflowEntryVisible: false,
      }), "cheat-code")
    }
  }, [activeAppId, dock.dockAppIds, setActiveAppId, workflowEntryVisible])

  const activeCustomApp = !isSystemAppId(activeAppId)
    ? customApps.state.snapshot?.apps.find((app) => app.id === activeAppId) ?? null
    : null

  useEffect(() => {
    if (shouldReturnToLauncher(activeAppId, customApps.state.snapshot)) {
      setActiveAppId("launcher", "navigation")
    }
  }, [activeAppId, customApps.state.snapshot, setActiveAppId])

  // 定期检测仓库状态（当用户在使用软件时删除文件夹的情况）
  useEffect(() => {
    // 如果已经显示空状态页面，不需要再轮询
    if (hasNoRepositories || isActiveRepositoryMissing) {
      return
    }

    // 每 5 秒检测一次仓库状态
    const intervalId = window.setInterval(() => {
      void manager.refreshRepositoryStates()
    }, 5000)

    // 当用户重新聚焦窗口时也检测一次
    const handleFocus = () => {
      void manager.refreshRepositoryStates()
    }

    window.addEventListener("focus", handleFocus)

    return () => {
      window.clearInterval(intervalId)
      window.removeEventListener("focus", handleFocus)
    }
  }, [hasNoRepositories, isActiveRepositoryMissing, manager])

  useEffect(() => {
    logger.info("App mounted.", {
      activeAppId,
    })
  }, [])

  useEffect(() => {
    publishActiveAppTab(activeAppId)
  }, [activeAppId])

  useEffect(() => {
    return subscribeOpenSettingsTab(() => {
      setActiveAppId("settings", "shortcut")
    })
  }, [setActiveAppId])

  const handleOpenAgentSession = useCallback((payload: OpenAgentSessionPayload) =>
    runAppNavigation(() => {
      discardMainTarget()
      selectApp("agent", "notification")
      setPendingAgentSession(payload)
    }), [discardMainTarget, selectApp])

  useEffect(() => {
    return subscribeOpenAgentSession((payload) => { void handleOpenAgentSession(payload) })
  }, [handleOpenAgentSession])

  useAgentConversationOpenRequest((request, controls) => {
    const pendingControls = { requestId: request.requestId, controls }
    pendingAgentOpenControlsRef.current = pendingControls
    void handleOpenAgentSession(request).then(async (accepted) => {
      if (accepted) return
      if (pendingAgentOpenControlsRef.current === pendingControls) pendingAgentOpenControlsRef.current = null
      await controls.acknowledge()
    }).catch((error) => logger.warn("Could not settle Agent navigation.", { error }))
  })

  const handlePendingAgentSessionConsumed = useCallback(() => {
    const consumedRequestId = pendingAgentSession?.requestId
    const pendingControls = pendingAgentOpenControlsRef.current
    if (pendingControls && pendingControls.requestId === consumedRequestId) {
      pendingAgentOpenControlsRef.current = null
      void pendingControls.controls.acknowledge().catch((error) => {
        logger.error("Failed to acknowledge Agent conversation open request.", {
          requestId: pendingControls.requestId,
          errorName: error instanceof Error ? error.name : typeof error,
        })
      })
    }
    setPendingAgentSession((current) => current?.requestId === consumedRequestId ? null : current)
  }, [pendingAgentSession?.requestId])

  useWatchNextAgentSession()

  useEffect(() => {
    return subscribeContentOpenRequest((request) => {
      void runAppNavigation(() => {
        discardMainTarget()
        ensureBodyInteractable()
        selectApp("launcher", "notification")
        setPendingAppContentOpenRequest(request)
      })
    })
  }, [discardMainTarget, selectApp])

  useEffect(() => {
    return subscribeOpenTerminalSession((request) => {
      void openMainTarget({ appId: "terminal", target: request })
    })
  }, [openMainTarget])

  const handleUpdateOpenRequest = useCallback(async (request: SynapseAppUpdateOpenRequest, controls: UpdateOpenRequestControls) => {
    const accepted = await runAppNavigation(() => {
      discardMainTarget()
      selectApp("settings", "notification")
      requestOpenSettingsAbout()
      logger.info("Update open request navigated to About Synapse.", {
        automatic: request.automatic,
        requestId: request.id,
      })
    })
    if (!accepted) await controls.acknowledge()
  }, [discardMainTarget, selectApp])

  useUpdateOpenRequest(handleUpdateOpenRequest)

  const accountUiVisible = isAccountUiVisible()

  const openCustomAppWindow = useCallback((appId: CustomAppId) => {
    const bridge = getSynapseBridge()
    if (!bridge) return
    void bridge.customApps.window.open(appId).catch((error) => {
      logger.error("Failed to open custom app window.", { appId, error })
      toast.error("打开应用失败")
    })
  }, [])

  const handleDockValueChange = useCallback((value: ActiveAppId) => {
    if (!isSystemAppId(value)) {
      const customApp = customApps.state.snapshot?.apps.find((app) => app.id === value)
      if (customApp?.openMode === "window") {
        openCustomAppWindow(customApp.id)
        return
      }
    }
    if (value === activeAppIdRef.current) {
      if (value === "launcher") {
        setLauncherResetKey((current) => current + 1)
      }
      return
    }

    setActiveAppId(value, "navigation")
  }, [customApps.state.snapshot, openCustomAppWindow, setActiveAppId])

  const openCustomApp = useCallback((appId: CustomAppId) => {
    const app = customApps.state.snapshot?.apps.find((candidate) => candidate.id === appId)
    if (!app) return
    if (app.openMode === "window") {
      openCustomAppWindow(app.id)
      return
    }
    void runAppNavigation(() => {
      discardMainTarget()
      selectApp(appId, "navigation")
    })
  }, [customApps.state.snapshot, discardMainTarget, openCustomAppWindow, selectApp])

  const activeSystemApp = isSystemAppId(activeAppId) ? getSystemAppManifest(activeAppId) : null

  return (
    <IdentityGate>
      <AppShellLayout
        leading={<AppShellUpdateIndicator />}
        dock={
          <AppShellDock
            apps={dock.pinnedApps}
            disabled={!dock.canEdit || dock.saving}
            value={activeAppId}
            onValueChange={handleDockValueChange}
            onRemoveApp={dock.removeDockApp}
            onManageDock={requestOpenSettingsDock}
          />
        }
        actions={accountUiVisible ? (
          <AppShellActions
            onOpenAccountSettings={requestOpenSettingsAccount}
            onOpenTarget={openMainTarget}
            notificationOpenRequest={pending?.appId === "message-center" ? pending : null}
            onNotificationOpenRequestConsumed={completeMainTargetWithoutId}
          />
        ) : null}
      >
        <div className="flex h-full min-h-0 flex-col">
          <ErrorBoundary fallbackTitle="应用出现问题">
            <AppSwitchTransition transitionKey={activeAppId}>
              <EmbeddedSystemAppShell
                appName={activeCustomApp?.name ?? activeSystemApp?.name ?? ""}
                mode="dock"
              >
                {activeCustomApp?.openMode === "iframe" ? (
                  <IframeCustomAppContent key={activeCustomApp.id} app={activeCustomApp} />
                ) : isSystemAppId(activeAppId) ? (
                  <SystemAppContent
                    appId={activeAppId}
                    launcherResetKey={launcherResetKey}
                    workflowEntryVisible={workflowEntryVisible}
                    resourceContentOpenRequest={pending?.appId === "resource-repository" ? pending.target as ContentOpenRequest : pendingAppContentOpenRequest}
                    onResourceContentOpenRequestConsumed={(requestId) => {
                      completeTargetById(requestId)
                      setPendingAppContentOpenRequest((current) => current?.requestId === requestId ? null : current)
                    }}
                    pendingAgentSession={pendingAgentSession}
                    onPendingAgentSessionConsumed={handlePendingAgentSessionConsumed}
                    terminalOpenRequest={pending?.appId === "terminal" ? pending.target : null}
                    onTerminalOpenRequestConsumed={completeTargetById}
                    meetingOpenRequest={pending?.appId === "meeting" ? pending.target : null}
                    onMeetingOpenRequestConsumed={completeMainTargetWithoutId}
                    gitOpenRequest={pending?.appId === "git" ? pending.target : null}
                    onGitOpenRequestConsumed={completeTargetById}
                    mailOpenRequest={pending?.appId === "mail" ? pending.target : null}
                    onMailOpenRequestConsumed={completeTargetById}
                    mailInternalOpenRequest={pending?.appId === "mail-internal" ? pending.target : null}
                    onMailInternalOpenRequestConsumed={completeTargetById}
                    todoOpenRequest={pending?.appId === "todos" ? pending.target : null}
                    onTodoOpenRequestConsumed={completeTargetById}
                    onOpenCustomApp={openCustomApp}
                  />
                ) : null}
              </EmbeddedSystemAppShell>
            </AppSwitchTransition>
          </ErrorBoundary>
        </div>
        <KnowledgeBaseStorageMigrationDialog
          progress={knowledgeBaseStorageMigration.progress}
          onCancel={knowledgeBaseStorageMigration.cancel}
        />
        <SynapseSkillAutoUpdateHost
          enabled={!knowledgeBaseStorageMigration.progress.active && !repoOnboardingActive}
        />
      </AppShellLayout>
    </IdentityGate>
  )
}

function App() {
  const { resetKey } = useAppConfig()
  const [agentConversationWindowRequest, setAgentConversationWindowRequest] =
    useState<ReturnType<typeof parseAgentConversationWindowRequest>>(null)
  const [standaloneContentWindowRequest, setStandaloneContentWindowRequest] = useState<ReturnType<typeof parseContentWindowRequest>>(null)

  useEffect(() => {
    setAgentConversationWindowRequest(parseAgentConversationWindowRequest(window.location.search))
    setStandaloneContentWindowRequest(parseContentWindowRequest(window.location.search))
  }, [])

  if (agentConversationWindowRequest) {
    return (
      <IdentityGate>
        <ErrorBoundary fallbackTitle="对话窗口出现问题">
          <AgentShareRenderHost />
          <AgentConversationWindowPage request={agentConversationWindowRequest} />
        </ErrorBoundary>
      </IdentityGate>
    )
  }

  if (standaloneContentWindowRequest) {
    return (
      <IdentityGate>
        <ErrorBoundary fallbackTitle="内容窗口出现问题">
          <ContentWindowPage request={standaloneContentWindowRequest} />
        </ErrorBoundary>
      </IdentityGate>
    )
  }


  return <><AgentShareRenderHost /><MainApp key={resetKey} /></>
}

export default App
