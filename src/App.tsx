import { useState } from "react"
import { RefreshCw } from "lucide-react"
import { AppShellProvider, type AppTabId } from "@/app-shell/context"
import { Button } from "@/components/ui/button"
import { getSynapseRuntime } from "@/lib/runtime"
import { cn } from "@/lib/utils"
import { RulesModule } from "@/modules/rules"
import { SettingsModule } from "@/modules/settings"
import { SkillsModule } from "@/modules/skills"

const tabItems: Array<{
  id: AppTabId
  label: string
  description: string
}> = [
  {
    id: "rules",
    label: "规则",
    description: "团队规则与协作约定",
  },
  {
    id: "skills",
    label: "技能",
    description: "技能包目录与安装上下文",
  },
  {
    id: "settings",
    label: "设置",
    description: "仓库信息与全局偏好",
  },
]

function SynapseMark() {
  return (
    <div className="flex size-12 items-center justify-center rounded-[18px] bg-primary text-lg text-primary-foreground shadow-[0_0_0_1px_#c96442]">
      <span className="font-editorial leading-none">S</span>
    </div>
  )
}

function App() {
  const runtime = getSynapseRuntime()
  const isMacOS = runtime.platform === "darwin"
  const [activeTab, setActiveTab] = useState<AppTabId>("rules")
  const [refreshBlockers, setRefreshBlockers] = useState<string[]>([])
  const [refreshRequestCount, setRefreshRequestCount] = useState(0)
  const [lastRefreshRequestedAt, setLastRefreshRequestedAt] = useState<number | null>(null)

  const isRefreshBlocked = refreshBlockers.length > 0
  const activeTabMeta = tabItems.find((tab) => tab.id === activeTab) ?? tabItems[0]
  const refreshLabel = lastRefreshRequestedAt
    ? new Date(lastRefreshRequestedAt).toLocaleTimeString("zh-CN", {
        hour: "2-digit",
        minute: "2-digit",
      })
    : null

  function setRefreshBlock(blockId: string, blocked: boolean) {
    setRefreshBlockers((current) => {
      if (blocked) {
        return current.includes(blockId) ? current : [...current, blockId]
      }

      return current.filter((item) => item !== blockId)
    })
  }

  function requestRefresh() {
    if (isRefreshBlocked) {
      return
    }

    setRefreshRequestCount((count) => count + 1)
    setLastRefreshRequestedAt(Date.now())
  }

  return (
    <AppShellProvider
      value={{
        activeTab,
        setActiveTab,
        requestRefresh,
        refreshRequestCount,
        lastRefreshRequestedAt,
        isRefreshBlocked,
        setRefreshBlock,
      }}
    >
      <main className="min-h-screen bg-background px-3 py-3 sm:px-4 sm:py-4">
        <div className="mx-auto flex min-h-[calc(100vh-1.5rem)] max-w-[1280px] flex-col overflow-hidden surface-shell sm:min-h-[calc(100vh-2rem)]">
          <header className={cn("app-drag border-b border-border bg-card/80", isMacOS ? "pt-7" : "pt-4")}>
            <div className="flex flex-col gap-6 px-4 pb-5 sm:px-6">
              <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
                <div className="flex items-start gap-4">
                  <SynapseMark />

                  <div className="space-y-2">
                    <div className="eyebrow">Knowledge Workspace</div>
                    <div className="space-y-2">
                      <h1 className="font-editorial text-[2rem] leading-none text-foreground">Synapse</h1>
                      <p className="max-w-xl text-sm leading-7 text-muted-foreground sm:text-base">
                        用统一的暖色工作台整理规则、技能和仓库设置，让信息更安静，也更容易维护。
                      </p>
                    </div>
                  </div>
                </div>

                <div className="app-no-drag flex flex-col gap-3 sm:flex-row sm:items-center">
                  <div className="min-w-[180px] text-left sm:text-right">
                    <div className="eyebrow">Current Section</div>
                    <div className="mt-2 text-sm text-foreground">{activeTabMeta.description}</div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {refreshLabel ? `上次刷新 ${refreshLabel}` : "尚未触发刷新"}
                    </div>
                  </div>

                  <Button className="h-10 px-4" disabled={isRefreshBlocked} onClick={requestRefresh} variant="secondary">
                    <RefreshCw className={cn("size-4", refreshRequestCount > 0 && "text-primary")} />
                    刷新界面
                  </Button>
                </div>
              </div>

              <nav aria-label="Primary" className="app-no-drag">
                <div className="inline-flex flex-wrap items-center gap-2 rounded-[18px] border border-border bg-secondary p-1.5">
                  {tabItems.map((tab) => {
                    const isActive = tab.id === activeTab

                    return (
                      <Button
                        key={tab.id}
                        className={cn(
                          "rounded-[14px] px-4",
                          !isActive && "bg-transparent text-muted-foreground shadow-none hover:bg-card hover:text-foreground",
                        )}
                        size="sm"
                        type="button"
                        variant={isActive ? "default" : "ghost"}
                        onClick={() => setActiveTab(tab.id)}
                      >
                        {tab.label}
                      </Button>
                    )
                  })}
                </div>
              </nav>
            </div>
          </header>

          <div className="min-h-0 flex-1 overflow-hidden bg-background/65 px-4 py-4 sm:px-6 sm:py-6">
            {tabItems.map((tab) => {
              const isActive = tab.id === activeTab

              return (
                <section key={tab.id} aria-hidden={!isActive} className={cn("h-full overflow-auto", !isActive && "hidden")}>
                  {tab.id === "rules" && <RulesModule />}
                  {tab.id === "skills" && <SkillsModule />}
                  {tab.id === "settings" && <SettingsModule />}
                </section>
              )
            })}
          </div>
        </div>
      </main>
    </AppShellProvider>
  )
}

export default App
