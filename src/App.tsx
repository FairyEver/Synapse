import { useEffect, useMemo, useState } from "react"
import { AppBrand } from "@/app-shell/components/app-brand"
import { AppShellActions } from "@/app-shell/components/app-shell-actions"
import { AppShellLayout } from "@/app-shell/components/app-shell-layout"
import { AppShellNavigation } from "@/app-shell/components/app-shell-navigation"
import { useAppConfig } from "@/app-shell/config"
import { createRendererLogger } from "@/app-shell/logging"
import { useRepositoryManager } from "@/app-shell/repository"
import { SkillsModule } from "@/modules/skills"
import { RulesModule } from "@/modules/rules"
import { SettingsModule } from "@/modules/settings"

type AppTabId = "rules" | "skills" | "settings"
const logger = createRendererLogger("app")

function App() {
  const { activeRepository, isReady } = useAppConfig()
  const { operations, states, syncRepository } = useRepositoryManager()
  const [activeTab, setActiveTab] = useState<AppTabId>("rules")
  const [isRulesCreateOpen, setIsRulesCreateOpen] = useState(false)
  const [isRulesDetailOpen, setIsRulesDetailOpen] = useState(false)
  const [isRulesInstallOpen, setIsRulesInstallOpen] = useState(false)
  const [isSkillsCreateOpen, setIsSkillsCreateOpen] = useState(false)
  const [isSkillsDetailOpen, setIsSkillsDetailOpen] = useState(false)
  const [isSkillsInstallOpen, setIsSkillsInstallOpen] = useState(false)
  const activeRepositoryOperation = activeRepository ? operations[activeRepository.uuid] : null
  const activeRepositoryState = activeRepository ? states[activeRepository.uuid] : null
  const hasBlockingModalOpen =
    isRulesCreateOpen
    || isRulesDetailOpen
    || isRulesInstallOpen
    || isSkillsCreateOpen
    || isSkillsDetailOpen
    || isSkillsInstallOpen
  const canSyncActiveRepository =
    activeRepositoryState?.status === "ready" && activeRepositoryState.isGitRepository
  const refreshTitle = activeRepositoryOperation?.isRunning
    ? activeRepositoryOperation.statusText ?? "正在同步仓库..."
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

  return (
    <AppShellLayout
      brand={<AppBrand />}
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
          busy={Boolean(activeRepositoryOperation?.isRunning)}
          disabled={
            !isReady
            || !canSyncActiveRepository
            || Boolean(activeRepositoryOperation?.isRunning)
            || hasBlockingModalOpen
          }
          onRefresh={() => {
            if (!activeRepository) {
              return
            }

            logger.info("Manual repository sync requested from app shell.", {
              repositoryUuid: activeRepository.uuid,
            })
            void syncRepository(activeRepository.uuid).catch((error) => {
              logger.error("Manual repository sync failed from app shell.", error)
              const message = error instanceof Error ? error.message : "仓库同步失败。"
              window.alert(message)
            })
          }}
          title={refreshTitle}
        />
      }
    >
      <div className="h-full min-h-0">
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
  )
}

export default App
