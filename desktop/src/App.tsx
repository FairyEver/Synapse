import { type ComponentType, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { AppShellActions } from "@/app-shell/components/app-shell-actions"
import { EmptyRepositoryState } from "@/app-shell/components/empty-repository-state"
import { IdentityGate } from "@/app-shell/components/identity-gate"
import { AppShellLayout } from "@/app-shell/components/app-shell-layout"
import { AppShellNavigation } from "@/app-shell/components/app-shell-navigation"
import { useActiveRepositorySwitch } from "@/app-shell/active-repository-switch"
import { useAppShellToolbarState } from "@/app-shell/use-app-shell-toolbar-state"
import { useAppConfig } from "@/app-shell/config"
import type { ContentOpenRequest } from "@/app-shell/content-navigation"
import { subscribeContentOpenRequest } from "@/app-shell/content-navigation"
import { ensureBodyInteractable } from "@/app-shell/dialog-navigate"
import { createRendererLogger } from "@/app-shell/logging"
import { updateDiagnosticContext } from "@/lib/diagnostic-context"
import {
  type OpenAgentSessionPayload,
  publishActiveAppTab,
  requestOpenSettingsAbout,
  requestOpenSettingsStorage,
  subscribeOpenAgentSession,
  subscribeOpenSettingsTab,
} from "@/app-shell/navigation"
import { useWatchNextAgentSession } from "@/app-shell/use-watch-next-agent-session"
import { useAppNotifications } from "@/app-shell/notifications"
import { isWorkflowEntryVisible } from "@/app-shell/workflow-entry-visibility"
import {
  useActiveRepository,
  useHasRepositories,
  useRepositoryActions,
  useRepositoryManager,
  useRepositoryState,
} from "@/app-shell/use-repository-manager"
import { getAllContentTypeIds } from "@/config/content-types"
import { WORKFLOW_ENTRY_CHEAT_CODE_NAME } from "@/lib/cheat-codes/names"
import { getSynapseBridge } from "@/lib/electron-bridge"
import { ErrorBoundary } from "@/components/error-boundary"
import { parseCcConversationWindowRequest } from "@/lib/cc-conversation-window"
import { parseContentWindowRequest } from "@/lib/content-window"
import { ContentWindowPage } from "@/modules/content/components/content-window-page"
import { RulesModule } from "@/modules/rules"
import { SkillsModule } from "@/modules/skills"
import { PromptsModule } from "@/modules/prompts"
import { SettingsModule } from "@/modules/settings"
import { DatabaseModule } from "@/modules/database"
import { EditorScanModule } from "@/modules/editor-scan"
import { AgentModule } from "@/modules/agent"
import { TaskSchedulerModule } from "@/modules/task-scheduler"
import { CcConversationDetailWindowPage } from "@/modules/usage-analysis/cc/components/conversation-detail-window-page"
import { CcUsageAnalysisModule, CodexUsageAnalysisModule } from "@/modules/usage-analysis"
import { WorkflowModule } from "@/modules/workflow"
import { ToolsModule } from "@/modules/tools"
import type { SynapseContentType } from "@/types/content"

type AppTabId = SynapseContentType | "agent" | "database" | "task-scheduler" | "editor-scan" | "usage-cc" | "usage-codex" | "workflow" | "tools" | "settings"
type AppTabChangeSource = "navigation" | "shortcut" | "notification" | "sync-status" | "cheat-code"
type DialogKind = "install"
type ContentDialogState = Record<DialogKind, boolean>
type ContentDialogStateMap = Record<SynapseContentType, ContentDialogState>
type ContentDialogHandlerMap = Record<SynapseContentType, Record<DialogKind, (open: boolean) => void>>

const logger = createRendererLogger("app")

const CONTENT_TAB_LABELS: Record<SynapseContentType, string> = {
  rule: "规则",
  skill: "技能",
  prompt: "提示词",
}

const TOP_LEVEL_CONTENT_TAB_ORDER = [
  "skill",
  "rule",
  "prompt",
] as const satisfies readonly SynapseContentType[]
const DEFAULT_APP_TAB: AppTabId = TOP_LEVEL_CONTENT_TAB_ORDER[0]

function createEmptyDialogStateMap(): ContentDialogStateMap {
  return Object.fromEntries(
    getAllContentTypeIds().map((contentType) => [contentType, {
      install: false,
    }]),
  ) as ContentDialogStateMap
}

const CONTENT_MODULE_COMPONENTS: Record<SynapseContentType, ComponentType<{
  onInstallDialogOpenChange?: (open: boolean) => void
  pendingContentOpenRequest?: ContentOpenRequest | null
  onPendingContentOpenRequestConsumed?: (requestId: string) => void
}>> = {
  rule: RulesModule,
  skill: SkillsModule,
  prompt: PromptsModule,
}

function MainApp() {
  const activeRepository = useActiveRepository()
  const hasRepositories = useHasRepositories()
  const {
    isSwitchingRepository,
    openRepositorySwitchDialog,
  } = useActiveRepositorySwitch()
  const { promise } = useAppNotifications()
  const manager = useRepositoryManager()
  const { syncRepository } = useRepositoryActions()
  const [activeTab, setActiveTabRaw] = useState<AppTabId>(DEFAULT_APP_TAB)
  const [contentDialogStates, setContentDialogStates] = useState<ContentDialogStateMap>(
    createEmptyDialogStateMap,
  )
  const contentDialogStatesRef = useRef(contentDialogStates)
  contentDialogStatesRef.current = contentDialogStates
  const [pendingContentOpenRequest, setPendingContentOpenRequest] =
    useState<ContentOpenRequest | null>(null)
  const [pendingAgentSession, setPendingAgentSession] =
    useState<OpenAgentSessionPayload | null>(null)
  const [workflowEntryVisible, setWorkflowEntryVisible] = useState(false)

  // 检查是否需要显示空状态页面
  const hasNoRepositories = !hasRepositories
  const activeRepositoryState = useRepositoryState(activeRepository?.uuid ?? "")
  const isActiveRepositoryMissing = activeRepositoryState?.status === "missing"

  const activeTabRef = useRef(activeTab)
  activeTabRef.current = activeTab

  useEffect(() => {
    updateDiagnosticContext({
      activeRepositoryUuid: activeRepository?.uuid,
      activeTab,
      windowType: "main",
    })
  }, [activeRepository?.uuid, activeTab])

  const setActiveTab = useCallback(
    (nextTab: AppTabId, source: AppTabChangeSource) => {
      const prevTab = activeTabRef.current
      if (prevTab !== nextTab) {
        logger.info("Top-level tab changed.", {
          from: prevTab,
          to: nextTab,
          source,
        })
      }
      setActiveTabRaw(nextTab)
    },
    [],
  )

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
    if (activeTab === "workflow" && !workflowEntryVisible) {
      setActiveTab(DEFAULT_APP_TAB, "cheat-code")
    }
  }, [activeTab, setActiveTab, workflowEntryVisible])

  const tabs = useMemo(
    () => [
      ...TOP_LEVEL_CONTENT_TAB_ORDER.map((contentType) => ({
        id: contentType,
        label: CONTENT_TAB_LABELS[contentType],
      })),
      { id: "agent" as const, label: "对话" },
      { id: "database" as const, label: "数据" },
      { id: "task-scheduler" as const, label: "定时" },
      { id: "tools" as const, label: "工具" },
      { id: "editor-scan" as const, label: "本机" },
      { id: "usage-cc" as const, label: "CC" },
      { id: "usage-codex" as const, label: "Codex" },
      ...(workflowEntryVisible ? [{ id: "workflow" as const, label: "工作流" }] : []),
      { id: "settings" as const, label: "设置" },
    ],
    [workflowEntryVisible],
  )

  const setContentDialogOpen = useCallback((
    contentType: SynapseContentType,
    kind: DialogKind,
    open: boolean,
  ) => {
    const currentState = contentDialogStatesRef.current
    if (currentState[contentType][kind] === open) {
      return
    }

    logger.info("Content dialog visibility changed.", {
      contentType,
      dialogKind: kind,
      open,
    })

    setContentDialogStates({
      ...currentState,
      [contentType]: {
        ...currentState[contentType],
        [kind]: open,
      },
    })
  }, [])

  const contentDialogHandlers = useMemo(
    () => Object.fromEntries(
      getAllContentTypeIds().map((contentType) => [contentType, {
        install: (open: boolean) => setContentDialogOpen(contentType, "install", open),
      }]),
    ) as ContentDialogHandlerMap,
    [setContentDialogOpen],
  )

  const hasContentDialogOpen = Object.values(contentDialogStates).some((state) => (
    state.install
  ))

  // 定期检测仓库状态（当用户在使用软件时删除文件夹的情况）
  useEffect(() => {
    // 如果已经显示空状态页面，或有内容对话框打开（避免重置用户编辑状态），不需要再轮询
    if (hasNoRepositories || isActiveRepositoryMissing || hasContentDialogOpen) {
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
  }, [hasNoRepositories, isActiveRepositoryMissing, hasContentDialogOpen, manager])

  useEffect(() => {
    logger.info("App mounted.", {
      activeTab,
    })
  }, [])

  useEffect(() => {
    publishActiveAppTab(activeTab)
  }, [activeTab])

  useEffect(() => {
    return subscribeOpenSettingsTab(() => {
      setActiveTab("settings", "shortcut")
    })
  }, [setActiveTab])

  const handleOpenAgentSession = useCallback((payload: OpenAgentSessionPayload) => {
    setActiveTab("agent", "notification")
    setPendingAgentSession(payload)
  }, [setActiveTab])

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
      setActiveTab(request.contentType, "shortcut")
      setPendingContentOpenRequest(request)
    })
  }, [setActiveTab])

  const handlePendingContentOpenRequestConsumed = useCallback((requestId: string) => {
    setPendingContentOpenRequest((current) =>
      current?.requestId === requestId ? null : current,
    )
  }, [])

  useEffect(() => {
    const bridge = getSynapseBridge()
    if (!bridge) {
      return
    }

    return bridge.updater.onOpenUpdatePage(() => {
      setActiveTab("settings", "notification")
      requestOpenSettingsAbout()
    })
  }, [setActiveTab])

  const hasBlockingModalOpen = hasContentDialogOpen
  const toolbarState = useAppShellToolbarState({
    hasBlockingModalOpen,
  })
  const handleManualRepositorySync = useCallback((source: "refresh" | "sync-status") => {
    if (!activeRepository) {
      return
    }

    logger.info("Manual repository sync requested from app shell.", {
      repositoryUuid: activeRepository.uuid,
      source,
    })
    void promise(
      () => syncRepository(activeRepository.uuid),
      {
        loading: "正在同步仓库...",
        success: (result) => result.message ?? "仓库同步完成。",
        error: (error) => error instanceof Error ? error.message : "同步仓库失败。",
      },
    ).catch((error) => {
      logger.error("Manual repository sync failed from app shell.", error)
    })
  }, [activeRepository, promise, syncRepository])

  // 如果没有仓库或当前仓库缺失，显示空状态页面
  if (hasNoRepositories) {
    return <EmptyRepositoryState reason="no-repositories" />
  }

  if (isActiveRepositoryMissing) {
    return <EmptyRepositoryState reason="active-repository-missing" />
  }

  return (
    <IdentityGate>
      <AppShellLayout
        navigation={
          <AppShellNavigation
            tabs={tabs}
            value={activeTab}
            onValueChange={(value) => setActiveTab(value as AppTabId, "navigation")}
          />
        }
        actions={
          <AppShellActions
            activeRepository={activeRepository}
            activityLabel={toolbarState.activityLabel}
            pendingPushCount={toolbarState.pendingPushCount}
            refreshBusy={toolbarState.refreshBusy}
            refreshDisabled={toolbarState.refreshDisabled}
            refreshTitle={toolbarState.refreshTitle}
            repositorySwitchDisabled={toolbarState.repositorySwitchDisabled}
            repositorySwitchTitle={toolbarState.repositorySwitchTitle}
            showRefresh={toolbarState.showRefresh}
            showRepositorySwitch={toolbarState.showRepositorySwitch}
            syncSnapshot={toolbarState.syncSnapshot}
            syncStatus={toolbarState.syncStatus}
            onOpenRepositorySettings={() => {
              setActiveTab("settings", "sync-status")
              requestOpenSettingsStorage()
            }}
            onSyncStatusRetry={() => handleManualRepositorySync("sync-status")}
            onRefresh={() => handleManualRepositorySync("refresh")}
            onRepositorySwitch={() => {
              if (toolbarState.repositorySwitchDisabled || isSwitchingRepository) {
                return
              }

              openRepositorySwitchDialog()
            }}
          />
        }
      >
        <div className="flex h-full min-h-0 flex-col">
          {TOP_LEVEL_CONTENT_TAB_ORDER.map((contentType) => {
            if (activeTab !== contentType) {
              return null
            }

            const ModuleComponent = CONTENT_MODULE_COMPONENTS[contentType]
            const dialogHandlers = contentDialogHandlers[contentType]

            return (
              <ErrorBoundary key={contentType} fallbackTitle={`${CONTENT_TAB_LABELS[contentType]}模块出现问题`}>
                <ModuleComponent
                  key={contentType}
                  onInstallDialogOpenChange={dialogHandlers.install}
                  pendingContentOpenRequest={pendingContentOpenRequest}
                  onPendingContentOpenRequestConsumed={handlePendingContentOpenRequestConsumed}
                />
              </ErrorBoundary>
            )
          })}
          <div className={activeTab !== "agent" ? "hidden" : "contents"}>
            <ErrorBoundary fallbackTitle="Agent 模块出现问题">
              <AgentModule
                pendingAgentSession={pendingAgentSession}
                onPendingAgentSessionConsumed={() => setPendingAgentSession(null)}
              />
            </ErrorBoundary>
          </div>
          {activeTab === "database" ? (
            <ErrorBoundary fallbackTitle="数据库模块出现问题">
              <DatabaseModule />
            </ErrorBoundary>
          ) : null}
          {activeTab === "task-scheduler" ? (
            <ErrorBoundary fallbackTitle="定时任务模块出现问题">
              <TaskSchedulerModule />
            </ErrorBoundary>
          ) : null}
          {activeTab === "tools" ? (
            <ErrorBoundary fallbackTitle="工具模块出现问题">
              <ToolsModule />
            </ErrorBoundary>
          ) : null}
          {activeTab === "editor-scan" ? (
            <ErrorBoundary fallbackTitle="IDE 模块出现问题">
              <EditorScanModule />
            </ErrorBoundary>
          ) : null}
          {activeTab === "usage-cc" ? (
            <ErrorBoundary fallbackTitle="CC 使用分析出现问题">
              <CcUsageAnalysisModule />
            </ErrorBoundary>
          ) : null}
          {activeTab === "usage-codex" ? (
            <ErrorBoundary fallbackTitle="Codex 使用分析出现问题">
              <CodexUsageAnalysisModule />
            </ErrorBoundary>
          ) : null}
          {activeTab === "workflow" && workflowEntryVisible ? (
            <ErrorBoundary fallbackTitle="工作流模块出现问题">
              <WorkflowModule />
            </ErrorBoundary>
          ) : null}
          {activeTab === "settings" ? (
            <ErrorBoundary fallbackTitle="设置模块出现问题">
              <SettingsModule />
            </ErrorBoundary>
          ) : null}
        </div>
      </AppShellLayout>
    </IdentityGate>
  )
}

function App() {
  const { resetKey } = useAppConfig()
  const [ccConversationWindowRequest, setCcConversationWindowRequest] = useState<ReturnType<typeof parseCcConversationWindowRequest>>(null)
  const [standaloneContentWindowRequest, setStandaloneContentWindowRequest] = useState<ReturnType<typeof parseContentWindowRequest>>(null)

  useEffect(() => {
    setCcConversationWindowRequest(parseCcConversationWindowRequest(window.location.search))
    setStandaloneContentWindowRequest(parseContentWindowRequest(window.location.search))
  }, [])

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

  return <MainApp key={resetKey} />
}

export default App
