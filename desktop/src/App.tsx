import { type ComponentType, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { AppShellActions } from "@/app-shell/components/app-shell-actions"
import { EmptyRepositoryState } from "@/app-shell/components/empty-repository-state"
import { IdentityGate } from "@/app-shell/components/identity-gate"
import { LicenseGate } from "@/app-shell/components/license-gate"
import { AppShellLayout } from "@/app-shell/components/app-shell-layout"
import { AppShellNavigation } from "@/app-shell/components/app-shell-navigation"
import { useActiveRepositorySwitch } from "@/app-shell/active-repository-switch"
import { useAppShellToolbarState } from "@/app-shell/use-app-shell-toolbar-state"
import { useAppConfig } from "@/app-shell/config"
import type { ContentOpenRequest } from "@/app-shell/content-navigation"
import { subscribeContentOpenRequest } from "@/app-shell/content-navigation"
import { createRendererLogger } from "@/app-shell/logging"
import { publishActiveAppTab, requestOpenSettingsAbout, subscribeOpenSettingsTab } from "@/app-shell/navigation"
import { useAppNotifications } from "@/app-shell/notifications"
import {
  useActiveRepository,
  useHasRepositories,
  useRepositoryActions,
  useRepositoryManager,
  useRepositoryState,
} from "@/app-shell/use-repository-manager"
import { CONTENT_TYPE_DEFINITIONS, getAllContentTypeIds } from "@/config/content-types"
import { getSynapseBridge } from "@/lib/electron-bridge"
import { parseContentWindowRequest } from "@/lib/content-window"
import { ContentDetailWindowPage } from "@/modules/content/components/content-detail-window-page"
import { RulesModule } from "@/modules/rules"
import { SkillsModule } from "@/modules/skills"
import { PromptsModule } from "@/modules/prompts"
import { SettingsModule } from "@/modules/settings"
import { DataStoreModule } from "@/modules/data-store"
import { EditorScanModule } from "@/modules/editor-scan"
import { AgentModule } from "@/modules/agent"
import { TaskSchedulerModule } from "@/modules/task-scheduler"
import type { SynapseContentType } from "@/types/content"

type AppTabId = SynapseContentType | "agent" | "data-store" | "task-scheduler" | "editor-scan" | "settings"
type DialogKind = "create" | "detail" | "install"
type ContentDialogState = Record<DialogKind, boolean>
type ContentDialogStateMap = Record<SynapseContentType, ContentDialogState>
type ContentDialogHandlerMap = Record<SynapseContentType, Record<DialogKind, (open: boolean) => void>>

const logger = createRendererLogger("app")

function createEmptyDialogStateMap(): ContentDialogStateMap {
  return Object.fromEntries(
    getAllContentTypeIds().map((contentType) => [contentType, {
      create: false,
      detail: false,
      install: false,
    }]),
  ) as ContentDialogStateMap
}

const CONTENT_MODULE_COMPONENTS: Record<SynapseContentType, ComponentType<{
  onCreateDialogOpenChange?: (open: boolean) => void
  onDetailDialogOpenChange?: (open: boolean) => void
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
  const [activeTab, setActiveTabRaw] = useState<AppTabId>("rule")
  const [contentDialogStates, setContentDialogStates] = useState<ContentDialogStateMap>(
    createEmptyDialogStateMap,
  )
  const contentDialogStatesRef = useRef(contentDialogStates)
  contentDialogStatesRef.current = contentDialogStates
  const [pendingContentOpenRequest, setPendingContentOpenRequest] =
    useState<ContentOpenRequest | null>(null)

  // 检查是否需要显示空状态页面
  const hasNoRepositories = !hasRepositories
  const activeRepositoryState = useRepositoryState(activeRepository?.uuid ?? "")
  const isActiveRepositoryMissing = activeRepositoryState?.status === "missing"

  const activeTabRef = useRef(activeTab)
  activeTabRef.current = activeTab

  const setActiveTab = useCallback(
    (nextTab: AppTabId, source: "navigation" | "shortcut" | "notification" | "sync-status") => {
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

  const tabs = useMemo(
    () => [
      ...CONTENT_TYPE_DEFINITIONS.map((definition) => ({
        id: definition.id,
        label: definition.tabLabel,
      })),
      { id: "agent" as const, label: "Agent" },
      { id: "data-store" as const, label: "数据库" },
      { id: "task-scheduler" as const, label: "定时任务" },
      { id: "editor-scan" as const, label: "IDE" },
      { id: "settings" as const, label: "设置" },
    ],
    [],
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
        create: (open: boolean) => setContentDialogOpen(contentType, "create", open),
        detail: (open: boolean) => setContentDialogOpen(contentType, "detail", open),
        install: (open: boolean) => setContentDialogOpen(contentType, "install", open),
      }]),
    ) as ContentDialogHandlerMap,
    [setContentDialogOpen],
  )

  const hasContentDialogOpen = Object.values(contentDialogStates).some((state) => (
    state.create || state.detail || state.install
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

  useEffect(() => {
    return subscribeContentOpenRequest((request) => {
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
          {CONTENT_TYPE_DEFINITIONS.map((definition) => {
            if (activeTab !== definition.id) {
              return null
            }

            const ModuleComponent = CONTENT_MODULE_COMPONENTS[definition.id]
            const dialogHandlers = contentDialogHandlers[definition.id]

            return (
              <ModuleComponent
                key={definition.id}
                onCreateDialogOpenChange={dialogHandlers.create}
                onDetailDialogOpenChange={dialogHandlers.detail}
                onInstallDialogOpenChange={dialogHandlers.install}
                pendingContentOpenRequest={pendingContentOpenRequest}
                onPendingContentOpenRequestConsumed={handlePendingContentOpenRequestConsumed}
              />
            )
          })}
          {activeTab === "agent" ? <AgentModule /> : null}
          {activeTab === "data-store" ? <DataStoreModule /> : null}
          {activeTab === "task-scheduler" ? <TaskSchedulerModule /> : null}
          {activeTab === "editor-scan" ? <EditorScanModule /> : null}
          {activeTab === "settings" ? <SettingsModule /> : null}
        </div>
      </AppShellLayout>
    </IdentityGate>
  )
}

function App() {
  const { resetKey } = useAppConfig()
  const [standaloneContentWindowRequest, setStandaloneContentWindowRequest] = useState<ReturnType<typeof parseContentWindowRequest>>(null)

  useEffect(() => {
    setStandaloneContentWindowRequest(parseContentWindowRequest(window.location.search))
  }, [])

  if (standaloneContentWindowRequest) {
    return (
      <LicenseGate>
        <IdentityGate>
          <ContentDetailWindowPage request={standaloneContentWindowRequest} />
        </IdentityGate>
      </LicenseGate>
    )
  }

  return (
    <LicenseGate>
      <MainApp key={resetKey} />
    </LicenseGate>
  )
}

export default App
