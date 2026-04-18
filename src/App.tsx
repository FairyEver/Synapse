import { type ComponentType, useCallback, useEffect, useMemo, useState } from "react"
import { AppShellActions } from "@/app-shell/components/app-shell-actions"
import { IdentityGate } from "@/app-shell/components/identity-gate"
import { AppShellLayout } from "@/app-shell/components/app-shell-layout"
import { AppShellNavigation } from "@/app-shell/components/app-shell-navigation"
import { useAppConfig } from "@/app-shell/config"
import { createRendererLogger } from "@/app-shell/logging"
import { useAppNotifications } from "@/app-shell/notifications"
import { useRepositoryManager } from "@/app-shell/repository"
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
import { RulesModule } from "@/modules/rules"
import { SkillsModule } from "@/modules/skills"
import { SettingsModule } from "@/modules/settings"
import type { SynapseContentType } from "@/types/content"

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

function App() {
  const { activeRepository, isReady } = useAppConfig()
  const { promise } = useAppNotifications()
  const { flushPendingPushes, operations, pendingPushes, states, syncRepository } = useRepositoryManager()
  const [activeTab, setActiveTab] = useState<AppTabId>("rule")
  const [contentDialogStates, setContentDialogStates] = useState<ContentDialogStateMap>(
    createEmptyDialogStateMap,
  )
  const [isPendingPushDialogOpen, setIsPendingPushDialogOpen] = useState(false)
  const activeRepositoryOperation = activeRepository ? operations[activeRepository.uuid] : null
  const activeRepositoryState = activeRepository ? states[activeRepository.uuid] : null
  const activePendingPushState = activeRepository ? pendingPushes[activeRepository.uuid] : null
  const isRepositoryTaskRunning = Boolean(activeRepositoryOperation?.isRunning)
  const isPushOperationRunning =
    activeRepositoryOperation?.operation === "push" && Boolean(activeRepositoryOperation.isRunning)
  const isSyncOperationRunning =
    activeRepositoryOperation?.operation === "sync" && Boolean(activeRepositoryOperation.isRunning)
  const repositoryActivityLabel = isRepositoryTaskRunning
    ? activeRepositoryOperation?.operation === "maintenance"
      ? "正在整理"
      : "正在同步"
    : null
  const hasContentDialogOpen = Object.values(contentDialogStates).some((state) => (
    state.create || state.detail || state.install
  ))
  const hasBlockingModalOpen = hasContentDialogOpen || isPendingPushDialogOpen
  const canSyncActiveRepository =
    activeRepositoryState?.status === "ready" && activeRepositoryState.isGitRepository
  const refreshTitle = activeRepositoryOperation?.isRunning
    ? activeRepositoryOperation.statusText ?? "正在同步..."
    : hasBlockingModalOpen
      ? "请先关闭当前弹窗"
      : !isReady
        ? "正在加载设置..."
        : activeRepository === null
          ? "还没有选择本地目录"
          : !activeRepositoryState
            ? "正在检查目录状态..."
            : activeRepositoryState?.status !== "ready"
              ? "当前目录不存在，无法同步"
              : !activeRepositoryState.isGitRepository
                ? "当前目录不是 Git 仓库，无法同步"
                : "同步仓库"

  const tabs = useMemo(
    () => [
      ...CONTENT_TYPE_DEFINITIONS.map((definition) => ({
        id: definition.id,
        label: definition.tabLabel,
      })),
      { id: "settings" as const, label: "Settings" },
    ],
    [],
  )

  useEffect(() => {
    logger.info("App mounted.", {
      activeTab,
    })
  }, [])

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
              {activePendingPushState.items.map((entry) => (
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
                  () => flushPendingPushes(activeRepository.uuid),
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
            activityLabel={repositoryActivityLabel}
            isPushBusy={isPushOperationRunning}
            pendingPushCount={activePendingPushState?.count ?? 0}
            pushDisabled={
              !isReady
              || !canSyncActiveRepository
              || Boolean(activeRepositoryOperation?.isRunning)
            }
            refreshBusy={isSyncOperationRunning}
            refreshDisabled={
              !isReady
              || !canSyncActiveRepository
              || Boolean(activeRepositoryOperation?.isRunning)
              || hasBlockingModalOpen
            }
            showRefresh={!isPushOperationRunning}
            onPush={() => setIsPendingPushDialogOpen(true)}
            onRefresh={() => {
              if (!activeRepository) {
                return
              }

              logger.info("Manual repository sync requested from app shell.", {
                repositoryUuid: activeRepository.uuid,
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
            }}
            refreshTitle={refreshTitle}
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

export default App
