import { useEffect, useMemo, useState } from "react"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { requireSynapseBridge } from "@/lib/electron-bridge"
import type { CcRecordListInput } from "@/types/usage-analysis-conversations"
import { ReportState } from "../../shared/components/report-state"
import type { UsageRangePreset } from "../../shared/types"
import { ConversationFilters } from "../components/conversation-filters"
import { RecordTable } from "../components/record-table"
import { useCcRecordDetails, useCcRecords } from "../hooks"

export function CcRecordsPage({
  range,
  refreshKey,
}: {
  readonly range: UsageRangePreset
  readonly refreshKey: number
}) {
  const [query, setQuery] = useState("")
  const [rawText, setRawText] = useState(false)
  const [loadedLimit, setLoadedLimit] = useState(50)
  const [expandedSessionId, setExpandedSessionId] = useState<string | null>(null)
  const [detailLimit, setDetailLimit] = useState(200)

  useEffect(() => {
    setLoadedLimit(50)
  }, [range])

  useEffect(() => {
    setDetailLimit(200)
  }, [expandedSessionId])

  const input = useMemo<CcRecordListInput>(() => ({
    preset: range,
    query,
    rawText,
    limit: loadedLimit,
    offset: 0,
  }), [range, query, rawText, loadedLimit])
  const state = useCcRecords(input, refreshKey)
  const detailState = useCcRecordDetails(
    expandedSessionId ? { sessionId: expandedSessionId, limit: detailLimit } : null,
    refreshKey,
  )
  const rows = state.data?.items ?? []
  const total = state.data?.total ?? 0
  const shown = rows.length
  const canLoadMore = shown > 0 && shown < total
  const initialLoading = state.loading && !state.data

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <ConversationFilters
        query={query}
        rawText={rawText}
        onQueryChange={(next) => {
          setQuery(next)
          setLoadedLimit(50)
        }}
        onRawTextChange={(next) => {
          setRawText(next)
          setLoadedLimit(50)
        }}
      />
      {initialLoading ? (
        <div className="flex min-h-40 items-center justify-center text-sm text-muted-foreground">
          正在加载
        </div>
      ) : (
        <ReportState loading={false} error={state.error} empty={rows.length === 0}>
          <RecordTable
            rows={rows}
            expandedSessionId={expandedSessionId}
            detailRows={detailState.data?.rows ?? []}
            detailTotal={detailState.data?.total ?? 0}
            detailLoading={detailState.loading && Boolean(expandedSessionId)}
            onToggleExpanded={(row) => {
              setExpandedSessionId((current) => current === row.sessionId ? null : row.sessionId)
            }}
            onOpenConversation={(row) => {
              void requireSynapseBridge().usageAnalysis.cc.openConversationWindow({
                sessionId: row.sessionId,
                title: row.title,
              })
            }}
            onOpenDetail={(row) => {
              void requireSynapseBridge().usageAnalysis.cc.openConversationWindow({
                sessionId: row.sessionId,
                title: row.workspaceLabel,
                focus: {
                  usageEventId: row.usageEventId ?? row.id,
                  timestampMs: row.timestampMs,
                },
              })
            }}
            onLoadMoreDetails={() => setDetailLimit((current) => current + 200)}
          />
          {shown > 0 ? (
            <div className="flex items-center justify-between border-t border-border px-3 py-2 text-sm text-muted-foreground">
              <span>已显示 {shown} / {total} 条记录</span>
              {canLoadMore ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={state.loading}
                  aria-busy={state.loading}
                  onClick={() => setLoadedLimit((current) => current + 50)}
                >
                  {state.loading ? (
                    <>
                      <Spinner />
                      加载中
                    </>
                  ) : "加载更多"}
                </Button>
              ) : null}
            </div>
          ) : null}
        </ReportState>
      )}
    </div>
  )
}
