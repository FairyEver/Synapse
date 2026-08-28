import { ExternalLink } from "lucide-react"
import { Button } from "@/components/ui/button"
import { TableCell, TableRow } from "@/components/ui/table"
import { formatDateTime } from "@/lib/date-time"
import type { CcRecordDetailRow } from "@/types/usage-analysis-conversations"
import { formatEstimatedCostLabel } from "./estimated-cost-label"

function formatInteger(value: number): string {
  return new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 0 }).format(value)
}

export function RecordDetailRows({
  rows,
  total,
  loading,
  onOpenDetail,
  onLoadMore,
}: {
  readonly rows: readonly CcRecordDetailRow[]
  readonly total: number
  readonly loading: boolean
  readonly onOpenDetail: (row: CcRecordDetailRow) => void
  readonly onLoadMore: () => void
}) {
  if (loading) {
    return (
      <TableRow>
        <TableCell colSpan={10} className="text-muted-foreground">正在读取明细</TableCell>
      </TableRow>
    )
  }

  if (rows.length === 0) {
    return (
      <TableRow>
        <TableCell colSpan={10} className="text-muted-foreground">暂无请求明细</TableCell>
      </TableRow>
    )
  }

  return (
    <>
      {rows.map((row) => (
        <TableRow key={row.id}>
          <TableCell />
          <TableCell />
          <TableCell className="text-muted-foreground">{formatDateTime(row.timestamp)}</TableCell>
          <TableCell>{row.model}</TableCell>
          <TableCell className="text-right tabular-nums">{formatInteger(row.tokens)}</TableCell>
          <TableCell className="text-right tabular-nums">{formatEstimatedCostLabel(row)}</TableCell>
          <TableCell className="text-right tabular-nums">{formatInteger(row.toolCalls)}</TableCell>
          <TableCell />
          <TableCell />
          <TableCell className="text-right">
            <Button type="button" size="sm" variant="outline" onClick={() => onOpenDetail(row)}>
              <ExternalLink data-icon="inline-start" />
              定位到对话
            </Button>
          </TableCell>
        </TableRow>
      ))}
      {rows.length < total ? (
        <TableRow>
          <TableCell colSpan={10} className="text-right">
            <div className="flex items-center justify-end gap-3 text-sm text-muted-foreground">
              <span>已显示 {rows.length} / {total}</span>
              <Button type="button" size="sm" variant="outline" onClick={onLoadMore}>
                加载更多请求
              </Button>
            </div>
          </TableCell>
        </TableRow>
      ) : null}
    </>
  )
}
