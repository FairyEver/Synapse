import { useEffect, useMemo, useRef, useState } from "react"
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
import { SkillsModule } from "@/modules/skills"
import { RulesModule } from "@/modules/rules"
import { SettingsModule } from "@/modules/settings"

type AppTabId = "rules" | "skills" | "settings"
const logger = createRendererLogger("app")

function App() {
  const { activeRepository, isReady } = useAppConfig()
  const { error: showError } = useAppNotifications()
  const { flushPendingPushes, operations, pendingPushes, states, syncRepository } = useRepositoryManager()
  const [activeTab, setActiveTab] = useState<AppTabId>("rules")
  const [isRulesCreateOpen, setIsRulesCreateOpen] = useState(false)
  const [isRulesDetailOpen, setIsRulesDetailOpen] = useState(false)
  const [isRulesInstallOpen, setIsRulesInstallOpen] = useState(false)
  const [isSkillsCreateOpen, setIsSkillsCreateOpen] = useState(false)
  const [isSkillsDetailOpen, setIsSkillsDetailOpen] = useState(false)
  const [isSkillsInstallOpen, setIsSkillsInstallOpen] = useState(false)
  const [isPendingPushDialogOpen, setIsPendingPushDialogOpen] = useState(false)
  const activeRepositoryOperation = activeRepository ? operations[activeRepository.uuid] : null
  const activeRepositoryState = activeRepository ? states[activeRepository.uuid] : null
  const activePendingPushState = activeRepository ? pendingPushes[activeRepository.uuid] : null
  const lastOperationErrorRef = useRef<string | null>(null)
  const isRepositoryTaskRunning = Boolean(activeRepositoryOperation?.isRunning)
  const repositoryActivityLabel = isRepositoryTaskRunning
    ? activeRepositoryOperation?.operation === "maintenance"
      ? "正在整理"
      : "正在同步"
    : null
  const hasBlockingModalOpen =
    isRulesCreateOpen
    || isRulesDetailOpen
    || isRulesInstallOpen
    || isSkillsCreateOpen
    || isSkillsDetailOpen
    || isSkillsInstallOpen
    || isPendingPushDialogOpen
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
      { id: "rules", label: "Rules" },
      { id: "skills", label: "Skills" },
      { id: "settings", label: "Settings" },
    ],
    [],
  )

  useEffect(() => {
    logger.info("App mounted.", {
      activeTab,
    })
  }, [])

  useEffect(() => {
    if (!activeRepositoryOperation?.error) {
      lastOperationErrorRef.current = null
      return
    }

    if (lastOperationErrorRef.current === activeRepositoryOperation.error) {
      return
    }

    lastOperationErrorRef.current = activeRepositoryOperation.error
    showError(activeRepositoryOperation.error)
  }, [activeRepositoryOperation?.error, showError])

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

                void flushPendingPushes(activeRepository.uuid).catch((error) => {
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
            isPushBusy={activeRepositoryOperation?.operation === "push" && Boolean(activeRepositoryOperation.isRunning)}
            pendingPushCount={activePendingPushState?.count ?? 0}
            pushDisabled={
              !isReady
              || !canSyncActiveRepository
              || Boolean(activeRepositoryOperation?.isRunning)
            }
            refreshBusy={isRepositoryTaskRunning}
            refreshDisabled={
              !isReady
              || !canSyncActiveRepository
              || Boolean(activeRepositoryOperation?.isRunning)
              || hasBlockingModalOpen
            }
            onPush={() => setIsPendingPushDialogOpen(true)}
            onRefresh={() => {
              if (!activeRepository) {
                return
              }

              logger.info("Manual repository sync requested from app shell.", {
                repositoryUuid: activeRepository.uuid,
              })
              void syncRepository(activeRepository.uuid).catch((error) => {
                logger.error("Manual repository sync failed from app shell.", error)
              })
            }}
            refreshTitle={refreshTitle}
          />
        }
      >
        <div className="flex h-full min-h-0 flex-col">
          <div className={activeTab === "rules" ? "h-full" : "hidden h-full"}>
            <RulesModule
              onCreateDialogOpenChange={setIsRulesCreateOpen}
              onDetailDialogOpenChange={setIsRulesDetailOpen}
              onInstallDialogOpenChange={setIsRulesInstallOpen}
            />
          </div>
          <div className={activeTab === "skills" ? "h-full" : "hidden h-full"}>
            <SkillsModule
              onCreateDialogOpenChange={setIsSkillsCreateOpen}
              onDetailDialogOpenChange={setIsSkillsDetailOpen}
              onInstallDialogOpenChange={setIsSkillsInstallOpen}
            />
          </div>
          <div className={activeTab === "settings" ? "h-full" : "hidden h-full"}>
            <SettingsModule />
          </div>
        </div>
      </AppShellLayout>
    </IdentityGate>
  )
}

export default App
