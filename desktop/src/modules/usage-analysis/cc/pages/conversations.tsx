import { useMemo, useState } from "react"
import { Spinner } from "@/components/ui/spinner"
import { requireSynapseBridge } from "@/lib/electron-bridge"
import type { CcConversationListInput } from "@/types/usage-analysis-conversations"
import { ReportState } from "../../shared/components/report-state"
import type { UsageRangePreset } from "../../shared/types"
import { ConversationFilters } from "../components/conversation-filters"
import { ConversationTable } from "../components/conversation-table"
import { useCcConversations } from "../hooks"

export function CcConversationsPage({
  range,
  refreshKey,
}: {
  readonly range: UsageRangePreset
  readonly refreshKey: number
}) {
  const [query, setQuery] = useState("")
  const [rawText, setRawText] = useState(false)
  const input = useMemo<CcConversationListInput>(() => ({
    preset: range,
    query,
    rawText,
    limit: 50,
    offset: 0,
  }), [range, query, rawText])
  const state = useCcConversations(input, refreshKey)
  const rows = state.data?.items ?? []

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <ConversationFilters
        query={query}
        rawText={rawText}
        onQueryChange={setQuery}
        onRawTextChange={setRawText}
      />
      {state.loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner />
          正在读取对话
        </div>
      ) : null}
      <ReportState loading={state.loading && !state.data} error={state.error} empty={rows.length === 0}>
        <ConversationTable
          rows={rows}
          onOpen={(row) => {
            void requireSynapseBridge().usageAnalysis.cc.openConversationWindow({
              sessionId: row.sessionId,
              title: row.title,
            })
          }}
        />
      </ReportState>
    </div>
  )
}
