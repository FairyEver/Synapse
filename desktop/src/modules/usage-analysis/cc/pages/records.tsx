import { useEffect, useMemo, useRef, useState } from "react"
import { requireSynapseBridge } from "@/lib/electron-bridge"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import type { CcRecordListInput } from "@/types/usage-analysis-conversations"
import { ReportState } from "../../shared/components/report-state"
import type { UsageRangePreset } from "../../shared/types"
import { ConversationFilters } from "../components/conversation-filters"
import { RecordTable } from "../components/record-table"
import { useCcRecordDetails, useCcRecords } from "../hooks"
import {
  CC_RECORD_PAGE_SIZE,
  formatRecordLoadStatus,
  shouldRequestNextRecords,
} from "../record-loading"

export function CcRecordsPage({
  range,
  refreshKey,
  refreshing = false,
}: {
  readonly range: UsageRangePreset
  readonly refreshKey: number
  readonly refreshing?: boolean
}) {
  const [query, setQuery] = useState("")
  const [rawText, setRawText] = useState(false)
  const [loadedLimit, setLoadedLimit] = useState(CC_RECORD_PAGE_SIZE)
  const [expandedSessionId, setExpandedSessionId] = useState<string | null>(null)
  const [detailLimit, setDetailLimit] = useState(200)
  const loadMoreRef = useRef<HTMLDivElement | null>(null)
  const lastRequestedShownRef = useRef<number | null>(null)

  useEffect(() => {
    setLoadedLimit(CC_RECORD_PAGE_SIZE)
    lastRequestedShownRef.current = null
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
  const initialLoading = state.loading && !state.data
  const statusText = formatRecordLoadStatus({ shown, total, loading: state.loading })
  const partial = state.data?.partial === true

  useEffect(() => {
    const target = loadMoreRef.current
    if (!target) return undefined

    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return
      if (!shouldRequestNextRecords({
        shown,
        total,
        loading: state.loading,
        lastRequestedShown: lastRequestedShownRef.current,
      })) return

      lastRequestedShownRef.current = shown
      setLoadedLimit((current) => current + CC_RECORD_PAGE_SIZE)
    }, { rootMargin: "160px 0px" })

    observer.observe(target)
    return () => observer.disconnect()
  }, [shown, total, state.loading])

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <ConversationFilters
        query={query}
        rawText={rawText}
        statusText={!initialLoading ? statusText : undefined}
        onQueryChange={(next) => {
          setQuery(next)
          setLoadedLimit(CC_RECORD_PAGE_SIZE)
          lastRequestedShownRef.current = null
        }}
        onRawTextChange={(next) => {
          setRawText(next)
          setLoadedLimit(CC_RECORD_PAGE_SIZE)
          lastRequestedShownRef.current = null
        }}
      />
      {initialLoading ? (
        <div className="flex min-h-40 items-center justify-center text-sm text-muted-foreground">
          正在加载
        </div>
      ) : (
        <ReportState loading={false} error={state.error} empty={rows.length === 0} refreshing={refreshing}>
          {partial ? (
            <Alert>
              <AlertTitle>结果可能不完整</AlertTitle>
              <AlertDescription>缩小时间范围或关键词后重试。</AlertDescription>
            </Alert>
          ) : null}
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
            <div
              ref={loadMoreRef}
              className="flex items-center justify-center border-t border-border px-3 py-2 text-sm text-muted-foreground"
              aria-busy={state.loading}
            >
              {statusText}
            </div>
          ) : null}
        </ReportState>
      )}
    </div>
  )
}
