import { requireSynapseBridge } from "@/lib/electron-bridge"
import { DetailsReportView } from "../../shared/components/report-views"
import type { UsageRangePreset } from "../../shared/types"
import { useCcDetails } from "../hooks"

export function CcDetailsPage({ range, refreshKey }: { readonly range: UsageRangePreset; readonly refreshKey: number }) {
  return (
    <DetailsReportView
      state={useCcDetails(range, refreshKey)}
      onOpenConversation={(row) => {
        void requireSynapseBridge().usageAnalysis.cc.openConversationWindow({
          sessionId: row.sessionId,
          title: row.workspaceLabel,
          focus: {
            usageEventId: row.usageEventId ?? row.id,
            timestampMs: row.timestampMs,
          },
        })
      }}
    />
  )
}
