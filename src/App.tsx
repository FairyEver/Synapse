import { useState } from "react"
import { RefreshCw } from "lucide-react"
import { AppShellProvider, type AppTabId } from "@/app-shell/context"
import { Button } from "@/components/ui/button"
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
    label: "Rules",
    description: "团队共享规则列表与创建入口",
  },
  {
    id: "skills",
    label: "Skills",
    description: "技能包浏览、安装与下载入口",
  },
  {
    id: "settings",
    label: "Settings",
    description: "仓库上下文与全局偏好配置",
  },
]

function SynapseMark() {
  return (
    <div className="relative size-12 overflow-hidden rounded-[18px] border border-white/80 bg-[linear-gradient(145deg,#0f766e_0%,#34d399_55%,#facc15_100%)] shadow-[0_16px_40px_-20px_rgba(15,23,42,0.55)]">
      <span className="absolute left-2.5 top-2.5 size-3 rounded-full bg-white/95 shadow-sm" />
      <span className="absolute right-2.5 top-3.5 size-2.5 rounded-full bg-white/90" />
      <span className="absolute bottom-2.5 left-3.5 size-2.5 rounded-full bg-[#0f172a]" />
      <span className="absolute bottom-3.5 right-3.5 size-3 rounded-full bg-[#0f172a]" />
      <span className="absolute left-[15px] top-[17px] h-px w-4 rotate-[14deg] bg-white/80" />
      <span className="absolute left-[18px] top-[19px] h-px w-4 rotate-[118deg] bg-white/70" />
      <span className="absolute left-[21px] top-[27px] h-px w-3 rotate-[6deg] bg-[#0f172a]/70" />
    </div>
  )
}

function App() {
  const runtime = window.synapse
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
        second: "2-digit",
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
      <main className="relative min-h-screen overflow-hidden bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.9),rgba(238,243,236,0.98)_42%,rgba(228,235,229,1)_100%)] text-foreground">
        <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(120deg,rgba(255,255,255,0.4),transparent_30%,rgba(15,118,110,0.05)_65%,rgba(250,204,21,0.08)_100%)]" />

        <div className="relative flex min-h-screen flex-col p-3 sm:p-4">
          <div className="mx-auto flex min-h-0 w-full max-w-[1600px] flex-1 flex-col overflow-hidden rounded-[32px] border border-white/80 bg-[rgba(248,250,246,0.78)] shadow-[0_32px_120px_-54px_rgba(15,23,42,0.55)] backdrop-blur-xl">
            <header className={cn("app-drag border-b border-border/60 bg-white/58", isMacOS ? "pt-7" : "pt-4")}>
              <div className="flex flex-col gap-4 px-4 pb-4 sm:px-6 lg:flex-row lg:items-center lg:justify-between">
                <div className="flex items-center gap-4 lg:w-[310px]">
                  <SynapseMark />

                  <div className="space-y-1">
                    <div className="text-[11px] font-medium uppercase tracking-[0.26em] text-muted-foreground">
                      Artificial Intelligence x Connection x Sharing
                    </div>
                    <div className="flex flex-wrap items-center gap-3">
                      <span className="text-2xl font-semibold tracking-tight text-foreground">Synapse</span>
                      <span className="rounded-full border border-border/70 bg-background/80 px-2.5 py-1 text-xs text-muted-foreground">
                        Shell
                      </span>
                    </div>
                  </div>
                </div>

                <nav aria-label="Primary" className="app-no-drag flex flex-1 justify-center">
                  <div className="inline-flex w-full max-w-[460px] items-center gap-1 rounded-full border border-border/70 bg-white/86 p-1 shadow-sm">
                    {tabItems.map((tab) => {
                      const isActive = tab.id === activeTab

                      return (
                        <button
                          key={tab.id}
                          className={cn(
                            "flex-1 rounded-full px-4 py-2.5 text-sm font-medium transition",
                            isActive
                              ? "bg-primary text-primary-foreground shadow-sm"
                              : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                          )}
                          type="button"
                          onClick={() => setActiveTab(tab.id)}
                        >
                          {tab.label}
                        </button>
                      )
                    })}
                  </div>
                </nav>

                <div className="flex items-center gap-3 lg:w-[310px] lg:justify-end">
                  <div className="hidden rounded-full border border-border/70 bg-white/86 px-3 py-2 text-xs text-muted-foreground xl:flex">
                    {refreshLabel ? (
                      <>
                        最近一次占位刷新
                        <span className="ml-1 font-medium text-foreground">{refreshLabel}</span>
                      </>
                    ) : (
                      "仓库同步会在步骤 6 接入"
                    )}
                  </div>

                  <Button
                    className="app-no-drag h-10 rounded-full px-4"
                    disabled={isRefreshBlocked}
                    onClick={requestRefresh}
                    variant="outline"
                  >
                    <RefreshCw className={cn("size-4", refreshRequestCount > 0 && "text-primary")} />
                    刷新
                  </Button>
                </div>
              </div>
            </header>

            <div className="border-b border-border/60 bg-white/46 px-4 py-3 sm:px-6">
              <div className="flex flex-col gap-2 text-sm sm:flex-row sm:items-center sm:justify-between">
                <div className="flex flex-wrap items-center gap-2 text-muted-foreground">
                  <span className="rounded-full bg-primary/10 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.22em] text-primary">
                    {activeTabMeta.label}
                  </span>
                  <span>{activeTabMeta.description}</span>
                </div>
                <span className="text-xs text-muted-foreground">
                  {isRefreshBlocked
                    ? "存在打开中的模态框，刷新已锁定"
                    : refreshLabel
                      ? `占位刷新事件已触发：${refreshLabel}`
                      : "刷新按钮已绑定占位事件，后续将接入仓库同步"}
                </span>
              </div>
            </div>

            <div className="relative min-h-0 flex-1 bg-[linear-gradient(180deg,rgba(255,255,255,0.18),transparent_24%)]">
              {tabItems.map((tab) => {
                const isActive = tab.id === activeTab

                return (
                  <section
                    key={tab.id}
                    aria-hidden={!isActive}
                    className={cn(
                      "absolute inset-0 overflow-auto p-4 transition-opacity duration-200 sm:p-6",
                      isActive ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0",
                    )}
                  >
                    {tab.id === "rules" && <RulesModule />}
                    {tab.id === "skills" && <SkillsModule />}
                    {tab.id === "settings" && <SettingsModule />}
                  </section>
                )
              })}
            </div>
          </div>
        </div>
      </main>
    </AppShellProvider>
  )
}

export default App
