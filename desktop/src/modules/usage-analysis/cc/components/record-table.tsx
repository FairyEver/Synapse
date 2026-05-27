import { Fragment } from "react"
import { ChevronDown, ChevronRight, ExternalLink } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { formatSynapseCost } from "@/lib/cost-currency"
import { formatDateTime } from "@/lib/date-time"
import type {
  CcRecordDetailRow,
  CcRecordListItem,
} from "@/types/usage-analysis-conversations"
import { RecordDetailRows } from "./record-detail-rows"

function formatInteger(value: number): string {
  return new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 0 }).format(value)
}

function normalizePath(value: string): string {
  return value.trim().replaceAll("\\", "/")
}

function pathParts(value: string): string[] {
  return normalizePath(value).split("/").filter(Boolean)
}

function shortenCommonPathPrefixes(values: readonly string[]): string[] {
  const normalizedValues = values.map(normalizePath)
  if (normalizedValues.length < 2) return normalizedValues

  const partsByValue = normalizedValues.map(pathParts)
  const minLength = Math.min(...partsByValue.map((parts) => parts.length))
  const maxPrefixLength = Math.max(0, minLength - 1)
  let prefixLength = 0

  while (
    prefixLength < maxPrefixLength
    && partsByValue.every((parts) => parts[prefixLength] === partsByValue[0]?.[prefixLength])
  ) {
    prefixLength += 1
  }

  if (prefixLength === 0) return normalizedValues

  return partsByValue.map((parts, index) =>
    parts.slice(prefixLength).join("/") || normalizedValues[index],
  )
}

export function RecordTable({
  rows,
  expandedSessionId,
  detailRows,
  detailTotal,
  detailLoading,
  onToggleExpanded,
  onOpenConversation,
  onOpenDetail,
  onLoadMoreDetails,
}: {
  readonly rows: readonly CcRecordListItem[]
  readonly expandedSessionId: string | null
  readonly detailRows: readonly CcRecordDetailRow[]
  readonly detailTotal: number
  readonly detailLoading: boolean
  readonly onToggleExpanded: (row: CcRecordListItem) => void
  readonly onOpenConversation: (row: CcRecordListItem) => void
  readonly onOpenDetail: (row: CcRecordDetailRow) => void
  readonly onLoadMoreDetails: () => void
}) {
  const titleValues = rows.map((row) => row.title || row.sessionId)
  const projectValues = rows.map((row) => row.workspaceLabel || row.workspaceKey || "-")
  const displayTitles = shortenCommonPathPrefixes(titleValues)
  const displayProjects = shortenCommonPathPrefixes(projectValues)

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>标题</TableHead>
          <TableHead>项目</TableHead>
          <TableHead>时间</TableHead>
          <TableHead>模型</TableHead>
          <TableHead className="text-right">Token</TableHead>
          <TableHead className="text-right">费用</TableHead>
          <TableHead className="text-right">工具</TableHead>
          <TableHead className="text-right">请求</TableHead>
          <TableHead className="text-right">事件</TableHead>
          <TableHead className="text-right">操作</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row, index) => {
          const expanded = row.sessionId === expandedSessionId
          const ExpandIcon = expanded ? ChevronDown : ChevronRight
          return (
            <Fragment key={row.sessionId}>
              <TableRow>
                <TableCell>
                  <div className="flex min-w-0 items-start gap-2">
                    <Button
                      type="button"
                      size="icon-sm"
                      variant="ghost"
                      onClick={() => onToggleExpanded(row)}
                      aria-label="展开记录"
                    >
                      <ExpandIcon />
                    </Button>
                    <div className="flex min-w-0 flex-col gap-1">
                      <span className="font-medium" title={titleValues[index]}>{displayTitles[index]}</span>
                      {row.matchSnippets?.map((snippet) => (
                        <span key={`${row.sessionId}:${snippet.eventId}`} className="max-w-xl truncate text-xs text-muted-foreground">
                          {snippet.text}
                        </span>
                      ))}
                    </div>
                  </div>
                </TableCell>
                <TableCell title={projectValues[index]}>{displayProjects[index]}</TableCell>
                <TableCell className="text-muted-foreground">{formatDateTime(row.lastUsedAt)}</TableCell>
                <TableCell>{row.modelSummary || "-"}</TableCell>
                <TableCell className="text-right tabular-nums">{formatInteger(row.tokens)}</TableCell>
                <TableCell className="text-right tabular-nums">{formatSynapseCost(row.estimatedCost)}</TableCell>
                <TableCell className="text-right tabular-nums">{formatInteger(row.toolCalls)}</TableCell>
                <TableCell className="text-right tabular-nums">{formatInteger(row.requestCount)}</TableCell>
                <TableCell className="text-right tabular-nums">{formatInteger(row.eventCount)}</TableCell>
                <TableCell className="text-right">
                  <Button type="button" size="sm" variant="outline" onClick={() => onOpenConversation(row)}>
                    <ExternalLink data-icon="inline-start" />
                    打开对话
                  </Button>
                </TableCell>
              </TableRow>
              {expanded ? (
                <RecordDetailRows
                  rows={detailRows}
                  total={detailTotal}
                  loading={detailLoading}
                  onOpenDetail={onOpenDetail}
                  onLoadMore={onLoadMoreDetails}
                />
              ) : null}
            </Fragment>
          )
        })}
      </TableBody>
    </Table>
  )
}
