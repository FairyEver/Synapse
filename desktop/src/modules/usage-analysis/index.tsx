import { useState } from "react"
import type { UsageMonitorViewId } from "@/modules/apps/types"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { CcUsagePage } from "./cc/cc-usage-page"
import { CodexUsagePage } from "./codex/codex-usage-page"

const USAGE_TABS: readonly { readonly id: UsageMonitorViewId; readonly label: string }[] = [
  { id: "cc", label: "CC" },
  { id: "codex", label: "Codex" },
]

export function CcUsageAnalysisModule() {
  return <CcUsagePage />
}

export function CodexUsageAnalysisModule() {
  return <CodexUsagePage />
}

export function UsageMonitorModule() {
  const [view, setView] = useState<UsageMonitorViewId>("cc")

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center border-b bg-background px-3 py-2">
        <Tabs value={view} onValueChange={(next) => setView(next as UsageMonitorViewId)}>
          <TabsList>
            {USAGE_TABS.map((tab) => (
              <TabsTrigger key={tab.id} value={tab.id}>{tab.label}</TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>
      <div className="min-h-0 flex-1">
        <Tabs value={view} className="contents">
          <TabsContent value="cc" className="m-0 h-full data-[state=inactive]:hidden">
            <CcUsagePage />
          </TabsContent>
          <TabsContent value="codex" className="m-0 h-full data-[state=inactive]:hidden">
            <CodexUsagePage />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  )
}
