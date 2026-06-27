import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { isAccountUiVisible } from "@/app-shell/account-ui-visibility"
import { AppShellActions } from "@/app-shell/components/app-shell-actions"
import { AppShellDock } from "@/app-shell/components/app-shell-dock"
import { IdentityGate } from "@/app-shell/components/identity-gate"
import { KnowledgeBaseStorageMigrationDialog } from "@/app-shell/components/knowledge-base-storage-migration-dialog"
import { AppShellLayout } from "@/app-shell/components/app-shell-layout"
import { useAppConfig } from "@/app-shell/config"
import { subscribeContentOpenRequest, type ContentOpenRequest } from "@/app-shell/content-navigation"
import { ensureBodyInteractable } from "@/app-shell/dialog-navigate"
import { useKnowledgeBaseStorageMigration } from "@/app-shell/hooks/use-knowledge-base-storage-migration"
import { createRendererLogger } from "@/app-shell/logging"
import { updateDiagnosticContext } from "@/lib/diagnostic-context"
import {
  type OpenAgentSessionPayload,
  publishActiveAppTab,
  requestOpenSettingsAccount,
  requestOpenSettingsAbout,
  subscribeOpenAgentSession,
  subscribeOpenSettingsTab,
} from "@/app-shell/navigation"
import { useWatchNextAgentSession } from "@/app-shell/use-watch-next-agent-session"
import { isWorkflowEntryVisible } from "@/app-shell/workflow-entry-visibility"
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
import { parseCcConversationWindowRequest } from "@/lib/cc-conversation-window"
import { parseContentStoreInstallWindowRequest } from "@/lib/content-store-install-window"
import { parseContentWindowRequest } from "@/lib/content-window"
import { ContentWindowPage } from "@/modules/content/components/content-window-page"
import { ContentStoreInstallWindowPage } from "@/modules/content-store-install"
import { AgentConversationWindowPage } from "@/modules/agent/components/agent-conversation-window-page"
import {
  listDockApps,
  normalizeDockAppIds,
  resolveDefaultDockAppId,
} from "@/modules/apps/dock"
import { getSystemAppManifest, listSystemApps } from "@/modules/apps/registry"
import { EmbeddedSystemAppShell } from "@/modules/apps/components/embedded-system-app-shell"
import { SystemAppContent } from "@/modules/apps/components/system-app-content"
import type { SynapseSystemAppId } from "@/modules/apps/types"
import { CcConversationDetailWindowPage } from "@/modules/usage-analysis/cc/components/conversation-detail-window-page"
import { SoundNotifierHost } from "../app-capabilities/sound-notifier/renderer/host"

type ActiveAppId = SynapseSystemAppId
type ActiveAppChangeSource = "navigation" | "shortcut" | "notification" | "sync-status" | "cheat-code"

const logger = createRendererLogger("app")

function MainApp() {
  const { config } = useAppConfig()
  const activeRepository = useActiveRepository()
  const hasRepositories = useHasRepositories()
  const manager = useRepositoryManager()
  const initialDockAppId = resolveDefaultDockAppId(listSystemApps(), {
    dockAppIds: config.global.dockAppIds,
    workflowEntryVisible: false,
  })
  const [activeAppId, setActiveAppIdRaw] = useState<ActiveAppId>(() => hasRepositories ? initialDockAppId : "agent")
  const [pendingAgentSession, setPendingAgentSession] =
    useState<OpenAgentSessionPayload | null>(null)
  const [pendingAppContentOpenRequest, setPendingAppContentOpenRequest] =
    useState<ContentOpenRequest | null>(null)
  const [launcherResetKey, setLauncherResetKey] = useState(0)
  const [workflowEntryVisible, setWorkflowEntryVisible] = useState(false)
  const knowledgeBaseStorageMigration = useKnowledgeBaseStorageMigration()

  // 检查是否需要显示空状态页面
  const hasNoRepositories = !hasRepositories
  const activeRepositoryState = useRepositoryState(activeRepository?.uuid ?? "")
  const isActiveRepositoryMissing = activeRepositoryState?.status === "missing"

  const activeAppIdRef = useRef(activeAppId)
  activeAppIdRef.current = activeAppId

  useEffect(() => {
    updateDiagnosticContext({
      activeRepositoryUuid: activeRepository?.uuid,
      activeAppId,
      windowType: "main",
    })
  }, [activeAppId, activeRepository?.uuid])

  const setActiveAppId = useCallback(
    (nextAppId: ActiveAppId, source: ActiveAppChangeSource) => {
      const previousAppId = activeAppIdRef.current
      if (previousAppId !== nextAppId) {
        logger.info("Active system app changed.", {
          from: previousAppId,
          to: nextAppId,
          source,
        })
      }
      setActiveAppIdRaw(nextAppId)
    },
    [],
  )

  useEffect(() => {
    if (!hasRepositories && activeAppIdRef.current === initialDockAppId) {
      setActiveAppId("agent", "navigation")
    }
  }, [hasRepositories, initialDockAppId, setActiveAppId])

  useEffect(() => {
    const bridge = getSynapseBridge()

    if (!bridge) {
      setWorkflowEntryVisible(false)
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
          setWorkflowEntryVisible(false)
        }
      })

    const unsubscribe = bridge.cheatCodes.onStateChanged((state) => {
      if (state.name === WORKFLOW_ENTRY_CHEAT_CODE_NAME) {
        setWorkflowEntryVisible(state.active)
      }
    })

    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [])

  useEffect(() => {
    if (activeAppId === "workflow" && !workflowEntryVisible) {
      setActiveAppId(resolveDefaultDockAppId(listSystemApps(), {
        dockAppIds: config.global.dockAppIds,
        workflowEntryVisible: false,
      }), "cheat-code")
    }
  }, [activeAppId, config.global.dockAppIds, setActiveAppId, workflowEntryVisible])

  const dockAppIds = useMemo(
    () => normalizeDockAppIds(config.global.dockAppIds),
    [config.global.dockAppIds],
  )

  const dockApps = useMemo(
    () => listDockApps(listSystemApps(), { workflowEntryVisible, dockAppIds }),
    [dockAppIds, workflowEntryVisible],
  )

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

  const handleOpenAgentSession = useCallback((payload: OpenAgentSessionPayload) => {
    setActiveAppId("agent", "notification")
    setPendingAgentSession(payload)
  }, [setActiveAppId])

  useEffect(() => {
    return subscribeOpenAgentSession(handleOpenAgentSession)
  }, [handleOpenAgentSession])

  useEffect(() => {
    const bridge = getSynapseBridge()
    return bridge?.agent.onOpenConversation(handleOpenAgentSession)
  }, [handleOpenAgentSession])

  useWatchNextAgentSession()

  useEffect(() => {
    return subscribeContentOpenRequest((request) => {
      ensureBodyInteractable()
      setActiveAppId("launcher", "notification")
      setPendingAppContentOpenRequest(request)
    })
  }, [setActiveAppId])

  useEffect(() => {
    const bridge = getSynapseBridge()
    if (!bridge) {
      return
    }

    return bridge.updater.onOpenUpdatePage(() => {
      setActiveAppId("settings", "notification")
      requestOpenSettingsAbout()
    })
  }, [setActiveAppId])

  const accountUiVisible = isAccountUiVisible()

  const handleDockValueChange = useCallback((value: ActiveAppId) => {
    if (value === activeAppIdRef.current) {
      if (value === "launcher") {
        setLauncherResetKey((current) => current + 1)
      }
      return
    }

    setActiveAppId(value, "navigation")
  }, [setActiveAppId])

  return (
    <IdentityGate>
      <SoundNotifierHost />
      <AppShellLayout
        dock={
          <AppShellDock
            apps={dockApps}
            value={activeAppId}
            onValueChange={handleDockValueChange}
          />
        }
        actions={accountUiVisible ? (
          <AppShellActions
            onOpenAccountSettings={requestOpenSettingsAccount}
          />
        ) : null}
      >
        <div className="flex h-full min-h-0 flex-col">
          <ErrorBoundary fallbackTitle="应用出现问题">
            <EmbeddedSystemAppShell appName={getSystemAppManifest(activeAppId)?.name ?? ""} mode="dock">
              <SystemAppContent
                appId={activeAppId}
                launcherResetKey={launcherResetKey}
                workflowEntryVisible={workflowEntryVisible}
                resourceContentOpenRequest={pendingAppContentOpenRequest}
                onResourceContentOpenRequestConsumed={(requestId) => {
                  setPendingAppContentOpenRequest((current) => current?.requestId === requestId ? null : current)
                }}
                pendingAgentSession={pendingAgentSession}
                onPendingAgentSessionConsumed={() => setPendingAgentSession(null)}
              />
            </EmbeddedSystemAppShell>
          </ErrorBoundary>
        </div>
        <KnowledgeBaseStorageMigrationDialog
          progress={knowledgeBaseStorageMigration.progress}
          onCancel={knowledgeBaseStorageMigration.cancel}
        />
      </AppShellLayout>
    </IdentityGate>
  )
}

function App() {
  const { resetKey } = useAppConfig()
  const [agentConversationWindowRequest, setAgentConversationWindowRequest] =
    useState<ReturnType<typeof parseAgentConversationWindowRequest>>(null)
  const [ccConversationWindowRequest, setCcConversationWindowRequest] = useState<ReturnType<typeof parseCcConversationWindowRequest>>(null)
  const [contentStoreInstallWindowRequest, setContentStoreInstallWindowRequest] = useState<ReturnType<typeof parseContentStoreInstallWindowRequest>>(null)
  const [standaloneContentWindowRequest, setStandaloneContentWindowRequest] = useState<ReturnType<typeof parseContentWindowRequest>>(null)

  useEffect(() => {
    setAgentConversationWindowRequest(parseAgentConversationWindowRequest(window.location.search))
    setCcConversationWindowRequest(parseCcConversationWindowRequest(window.location.search))
    setContentStoreInstallWindowRequest(parseContentStoreInstallWindowRequest(window.location.search))
    setStandaloneContentWindowRequest(parseContentWindowRequest(window.location.search))
  }, [])

  if (agentConversationWindowRequest) {
    return (
      <IdentityGate>
        <ErrorBoundary fallbackTitle="对话窗口出现问题">
          <AgentConversationWindowPage request={agentConversationWindowRequest} />
        </ErrorBoundary>
      </IdentityGate>
    )
  }

  if (ccConversationWindowRequest) {
    return (
      <IdentityGate>
        <ErrorBoundary fallbackTitle="对话窗口出现问题">
          <CcConversationDetailWindowPage request={ccConversationWindowRequest} />
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

  if (contentStoreInstallWindowRequest) {
    return (
      <IdentityGate>
        <ErrorBoundary fallbackTitle="安装窗口出现问题">
          <ContentStoreInstallWindowPage request={contentStoreInstallWindowRequest} />
        </ErrorBoundary>
      </IdentityGate>
    )
  }

  return <MainApp key={resetKey} />
}

export default App
