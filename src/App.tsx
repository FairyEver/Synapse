import { useMemo, useState } from "react"
import { AppBrand } from "@/app-shell/components/app-brand"
import { AppShellActions } from "@/app-shell/components/app-shell-actions"
import { AppShellLayout } from "@/app-shell/components/app-shell-layout"
import { AppShellNavigation } from "@/app-shell/components/app-shell-navigation"
import { useAppConfig } from "@/app-shell/config"
import { useRepositoryManager } from "@/app-shell/repository"
import { SkillsModule } from "@/modules/skills"
import { RulesModule } from "@/modules/rules"
import { SettingsModule } from "@/modules/settings"

type AppTabId = "rules" | "skills" | "settings"

function App() {
  const { activeRepository, isReady } = useAppConfig()
  const { operations, syncRepository } = useRepositoryManager()
  const [activeTab, setActiveTab] = useState<AppTabId>("rules")
  const activeRepositoryOperation = activeRepository ? operations[activeRepository.uuid] : null

  const tabs = useMemo(
    () => [
      { id: "rules", label: "Rules" },
      { id: "skills", label: "Skills" },
      { id: "settings", label: "Settings" },
    ],
    [],
  )

  return (
    <AppShellLayout
      brand={<AppBrand />}
      navigation={<AppShellNavigation tabs={tabs} value={activeTab} onValueChange={(value) => setActiveTab(value as AppTabId)} />}
      actions={
        <AppShellActions
          busy={Boolean(activeRepositoryOperation?.isRunning)}
          disabled={!isReady || activeRepository === null || Boolean(activeRepositoryOperation?.isRunning)}
          onRefresh={() => {
            if (!activeRepository) {
              return
            }

            void syncRepository(activeRepository.uuid).catch((error) => {
              const message = error instanceof Error ? error.message : "仓库同步失败。"
              window.alert(message)
            })
          }}
          title={activeRepositoryOperation?.isRunning ? activeRepositoryOperation.statusText ?? "正在同步仓库..." : "刷新仓库"}
        />
      }
    >
      <div className="h-full min-h-0">
        <div className={activeTab === "rules" ? "h-full" : "hidden h-full"}>
          <RulesModule />
        </div>
        <div className={activeTab === "skills" ? "h-full" : "hidden h-full"}>
          <SkillsModule />
        </div>
        <div className={activeTab === "settings" ? "h-full" : "hidden h-full"}>
          <SettingsModule />
        </div>
      </div>
    </AppShellLayout>
  )
}

export default App
