import { useEffect, useMemo, useRef, useState } from "react"
import { requireSynapseBridge } from "@/lib/electron-bridge"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import type { CcRecordListInput, CcRecordListResult } from "@/types/usage-analysis-conversations"
import { ReportState } from "../../shared/components/report-state"
import type { UsageRangePreset } from "../../shared/types"
import { ConversationFilters } from "../components/conversation-filters"
import { RecordTable } from "../components/record-table"
import { useCcRecordDetails, useCcRecords } from "../hooks"
import {
  CC_RECORD_PAGE_SIZE,
  formatRecordLoadStatus,
  shouldRequestNextRecords,
  shouldShowRecordEmptyState,
  shouldShowRecordLoadMoreSentinel,
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
  const [debouncedQuery, setDebouncedQuery] = useState("")
  const [rawText, setRawText] = useState(false)
  const [loadedLimit, setLoadedLimit] = useState(CC_RECORD_PAGE_SIZE)
  const [expandedSessionId, setExpandedSessionId] = useState<string | null>(null)
  const [detailLimit, setDetailLimit] = useState(200)
  const [rawSearchCursor, setRawSearchCursor] = useState<string | undefined>(undefined)
  const [rawSearchData, setRawSearchData] = useState<CcRecordListResult | null>(null)
  const loadMoreRef = useRef<HTMLDivElement | null>(null)
  const lastRequestedShownRef = useRef<number | null>(null)
  const lastRequestedRawCursorRef = useRef<string | null>(null)
  const appliedRawPageRef = useRef<{ cursor: string; data: CcRecordListResult } | null>(null)

  useEffect(() => {
    if (!rawText) {
      setDebouncedQuery(query)
      return undefined
    }

    const timer = window.setTimeout(() => {
      setDebouncedQuery(query)
    }, 250)
    return () => window.clearTimeout(timer)
  }, [query, rawText])

  const effectiveQuery = rawText ? debouncedQuery : query

  useEffect(() => {
    setLoadedLimit(CC_RECORD_PAGE_SIZE)
    setRawSearchCursor(undefined)
    setRawSearchData(null)
    lastRequestedShownRef.current = null
    lastRequestedRawCursorRef.current = null
    appliedRawPageRef.current = null
  }, [range, effectiveQuery, rawText, refreshKey])

  useEffect(() => {
    setDetailLimit(200)
  }, [expandedSessionId])

  const input = useMemo<CcRecordListInput>(() => {
    if (rawText) {
      return {
        preset: range,
        query: effectiveQuery,
        rawText,
        limit: CC_RECORD_PAGE_SIZE,
        offset: rawSearchCursor ? Number(rawSearchCursor) : 0,
        ...(rawSearchCursor ? { cursor: rawSearchCursor } : {}),
      }
    }
    return {
      preset: range,
      query: effectiveQuery,
      rawText,
      limit: loadedLimit,
      offset: 0,
    }
  }, [range, effectiveQuery, rawText, loadedLimit, rawSearchCursor])
  const state = useCcRecords(input, refreshKey)
  const detailState = useCcRecordDetails(
    expandedSessionId ? { sessionId: expandedSessionId, limit: detailLimit } : null,
    refreshKey,
  )
  useEffect(() => {
    if (!rawText || !state.data) return

    const cursor = rawSearchCursor ?? "0"
    const pageData = state.data
    const appliedPage = appliedRawPageRef.current
    if (appliedPage?.cursor === cursor && appliedPage.data === pageData) return
    appliedRawPageRef.current = { cursor, data: pageData }

    setRawSearchData((current) => {
      const currentItems = cursor === "0" ? [] : [...(current?.items ?? [])]
      const seen = new Set(currentItems.map((item) => item.sessionId))
      for (const item of pageData.items) {
        if (seen.has(item.sessionId)) continue
        currentItems.push(item)
        seen.add(item.sessionId)
      }
      return {
        ...pageData,
        items: currentItems,
      }
    })
  }, [rawText, rawSearchCursor, state.data])

  const recordsData = rawText ? rawSearchData : state.data
  const rows = recordsData?.items ?? []
  const total = recordsData?.total ?? 0
  const shown = rows.length
  const initialLoading = state.loading && !recordsData
  const rawSearchNextCursor = rawText ? recordsData?.nextCursor : undefined
  const statusTotal = rawText && !rawSearchNextCursor ? shown : total
  const statusText = formatRecordLoadStatus({ shown, total: statusTotal, loading: state.loading })
  const partial = recordsData?.partial === true
  const hasRawSearchNextCursor = Boolean(rawSearchNextCursor)
  const empty = shouldShowRecordEmptyState({
    shown,
    rawText,
    hasNextCursor: hasRawSearchNextCursor,
    partial,
  })
  const showLoadMoreSentinel = shouldShowRecordLoadMoreSentinel({
    shown,
    rawText,
    hasNextCursor: hasRawSearchNextCursor,
  })

  useEffect(() => {
    const target = loadMoreRef.current
    if (!target) return undefined

    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return
      if (rawText) {
        if (!rawSearchNextCursor || state.loading || lastRequestedRawCursorRef.current === rawSearchNextCursor) return

        lastRequestedRawCursorRef.current = rawSearchNextCursor
        setRawSearchCursor(rawSearchNextCursor)
        return
      }
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
  }, [rawText, rawSearchNextCursor, shown, total, state.loading])

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
        <ReportState loading={false} error={state.error} empty={empty} refreshing={refreshing}>
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
          {showLoadMoreSentinel ? (
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
