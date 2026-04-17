import { useMemo, useState } from "react"
import { AppBrand } from "@/app-shell/components/app-brand"
import { AppShellActions } from "@/app-shell/components/app-shell-actions"
import { AppShellLayout } from "@/app-shell/components/app-shell-layout"
import { AppShellNavigation } from "@/app-shell/components/app-shell-navigation"
import { useAppConfig } from "@/app-shell/config"
import { SkillsModule } from "@/modules/skills"
import { RulesModule } from "@/modules/rules"
import { SettingsModule } from "@/modules/settings"

type AppTabId = "rules" | "skills" | "settings"

function App() {
  const { activeRepository, isReady } = useAppConfig()
  const [activeTab, setActiveTab] = useState<AppTabId>("rules")

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
          disabled={!isReady || activeRepository === null}
          onRefresh={() => {
            console.info("[synapse] Repository refresh will be implemented in step 6.")
          }}
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
