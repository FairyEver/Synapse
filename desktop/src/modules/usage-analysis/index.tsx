import { useState } from "react"
import type { UsageMonitorViewId } from "@/modules/apps/types"
import { Tabs, TabsContent } from "@/components/ui/tabs"
import { SystemAppWindowShell } from "@/modules/apps/components/system-app-window-shell"
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
    <SystemAppWindowShell tabs={USAGE_TABS} value={view} onValueChange={setView}>
      <Tabs value={view} className="contents">
        <TabsContent value="cc" className="m-0 h-full data-[state=inactive]:hidden">
          <CcUsagePage />
        </TabsContent>
        <TabsContent value="codex" className="m-0 h-full data-[state=inactive]:hidden">
          <CodexUsagePage />
        </TabsContent>
      </Tabs>
    </SystemAppWindowShell>
  )
}
