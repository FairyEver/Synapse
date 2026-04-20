import { type ComponentType, useCallback, useEffect, useMemo, useState } from "react"
import { AppShellActions } from "@/app-shell/components/app-shell-actions"
import { EmptyRepositoryState } from "@/app-shell/components/empty-repository-state"
import { IdentityGate } from "@/app-shell/components/identity-gate"
import { AppShellLayout } from "@/app-shell/components/app-shell-layout"
import { AppShellNavigation } from "@/app-shell/components/app-shell-navigation"
import { useActiveRepositorySwitch } from "@/app-shell/active-repository-switch"
import { useAppShellToolbarState } from "@/app-shell/use-app-shell-toolbar-state"
import { useAppConfig } from "@/app-shell/config"
import { createRendererLogger } from "@/app-shell/logging"
import { publishActiveAppTab, subscribeOpenSettingsTab } from "@/app-shell/navigation"
import { useAppNotifications } from "@/app-shell/notifications"
import { useRepositoryManager, usePendingPushes, useRepositoryState } from "@/app-shell/use-repository-manager"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { CONTENT_TYPE_DEFINITIONS, getAllContentTypeIds } from "@/config/content-types"
import { parseContentWindowRequest } from "@/lib/content-window"
import { ContentDetailWindowPage } from "@/modules/content/components/content-detail-window-page"
import { RulesModule } from "@/modules/rules"
import { SkillsModule } from "@/modules/skills"
import { SettingsModule } from "@/modules/settings"
import type { SynapseContentType } from "@/types/content"
import type { SynapsePendingPushEntry } from "@/types/repository"

type AppTabId = SynapseContentType | "settings"
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
}>> = {
  rule: RulesModule,
  skill: SkillsModule,
}

function MainApp() {
  const { activeRepository, config } = useAppConfig()
  const {
    isSwitchingRepository,
    openRepositorySwitchDialog,
  } = useActiveRepositorySwitch()
  const { promise } = useAppNotifications()
  const manager = useRepositoryManager()
  const [activeTab, setActiveTab] = useState<AppTabId>("rule")
  const [contentDialogStates, setContentDialogStates] = useState<ContentDialogStateMap>(
    createEmptyDialogStateMap,
  )
  const [isPendingPushDialogOpen, setIsPendingPushDialogOpen] = useState(false)

  // 检查是否需要显示空状态页面
  const hasNoRepositories = config.repositories.length === 0
  const activeRepositoryState = useRepositoryState(activeRepository?.uuid ?? "")
  const isActiveRepositoryMissing = activeRepositoryState?.status === "missing"

  // 获取待推送状态
  const activePendingPushState = usePendingPushes(activeRepository?.uuid ?? "")

  const tabs = useMemo(
    () => [
      ...CONTENT_TYPE_DEFINITIONS.map((definition) => ({
        id: definition.id,
        label: definition.tabLabel,
      })),
      { id: "settings" as const, label: "设置" },
    ],
    [],
  )

  const setContentDialogOpen = useCallback((
    contentType: SynapseContentType,
    kind: DialogKind,
    open: boolean,
  ) => {
    setContentDialogStates((currentState) => {
      if (currentState[contentType][kind] === open) {
        return currentState
      }

      return {
        ...currentState,
        [contentType]: {
          ...currentState[contentType],
          [kind]: open,
        },
      }
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
      setActiveTab("settings")
    })
  }, [])

  const hasBlockingModalOpen = hasContentDialogOpen || isPendingPushDialogOpen
  const toolbarState = useAppShellToolbarState({
    hasBlockingModalOpen,
  })

  // 如果没有仓库或当前仓库缺失，显示空状态页面
  if (hasNoRepositories) {
    return <EmptyRepositoryState reason="no-repositories" />
  }

  if (isActiveRepositoryMissing) {
    return <EmptyRepositoryState reason="active-repository-missing" />
  }

  return (
    <IdentityGate>
      <AlertDialog open={isPendingPushDialogOpen} onOpenChange={setIsPendingPushDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>同步变更</AlertDialogTitle>
            <AlertDialogDescription>
              本地有 {activePendingPushState?.count ?? 0} 条变更等待同步到仓库。
            </AlertDialogDescription>
          </AlertDialogHeader>

          {activePendingPushState && activePendingPushState.items.length > 0 ? (
            <div className="flex flex-col gap-2 text-sm text-muted-foreground">
              {activePendingPushState.items.map((entry: SynapsePendingPushEntry) => (
                <p key={entry.id}>
                  · {entry.action} {entry.title ?? entry.targetId}
                </p>
              ))}
            </div>
          ) : null}

          <AlertDialogFooter>
            <AlertDialogCancel>稍后</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (!activeRepository) {
                  return
                }

                void promise(
                  () => manager.pushRepository(activeRepository.uuid),
                  {
                    loading: "正在同步变更...",
                    success: (result) => result.message ?? "同步完成。",
                    error: (error) => error instanceof Error ? error.message : "同步变更失败。",
                  },
                ).catch((error) => {
                  logger.error("Pending push flush failed from app shell.", error)
                })
              }}
            >
              立即同步
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AppShellLayout
        navigation={
          <AppShellNavigation
            tabs={tabs}
            value={activeTab}
            onValueChange={(value) => {
              logger.info("Top-level tab changed.", {
                nextTab: value,
              })
              setActiveTab(value as AppTabId)
            }}
          />
        }
        actions={
          <AppShellActions
            activityLabel={toolbarState.activityLabel}
            isPushBusy={toolbarState.isPushBusy}
            pendingPushCount={toolbarState.pendingPushCount}
            pushDisabled={toolbarState.pushDisabled}
            refreshBusy={toolbarState.refreshBusy}
            refreshDisabled={toolbarState.refreshDisabled}
            refreshTitle={toolbarState.refreshTitle}
            repositorySwitchDisabled={toolbarState.repositorySwitchDisabled}
            repositorySwitchTitle={toolbarState.repositorySwitchTitle}
            showRefresh={toolbarState.showRefresh}
            showRepositorySwitch={toolbarState.showRepositorySwitch}
            onPush={() => setIsPendingPushDialogOpen(true)}
            onRefresh={() => {
              if (!activeRepository) {
                return
              }

              logger.info("Manual repository sync requested from app shell.", {
                repositoryUuid: activeRepository.uuid,
              })
              void promise(
                () => manager.syncRepository(activeRepository.uuid),
                {
                  loading: "正在同步仓库...",
                  success: (result) => result.message ?? "仓库同步完成。",
                  error: (error) => error instanceof Error ? error.message : "同步仓库失败。",
                },
              ).catch((error) => {
                logger.error("Manual repository sync failed from app shell.", error)
              })
            }}
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
              />
            )
          })}
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
      <IdentityGate>
        <ContentDetailWindowPage request={standaloneContentWindowRequest} />
      </IdentityGate>
    )
  }

  return <MainApp key={resetKey} />
}

export default App
