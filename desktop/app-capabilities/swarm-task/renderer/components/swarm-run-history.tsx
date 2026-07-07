import { History, RotateCcw } from "lucide-react"
import { Button } from "../../../../src/components/ui/button"
import {
  Empty,
  EmptyHeader,
  EmptyTitle,
} from "../../../../src/components/ui/empty"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../../../../src/components/ui/table"
import type { SwarmRun } from "../../shared/schema"

type SwarmRunHistoryProps = {
  readonly runs: readonly SwarmRun[]
  readonly onStartRun: () => void
}

export function SwarmRunHistory({ runs, onStartRun }: SwarmRunHistoryProps) {
  if (runs.length === 0) {
    return (
      <Empty className="min-h-64 border-0">
        <EmptyHeader>
          <EmptyTitle>暂无历史</EmptyTitle>
        </EmptyHeader>
      </Empty>
    )
  }

  return (
    <div className="grid h-full min-h-0 gap-4 p-4 sm:p-5">
      <div className="flex items-center justify-end">
        <Button type="button" variant="outline" onClick={onStartRun}>
          <RotateCcw data-icon="inline-start" />
          再运行
        </Button>
      </div>
      <div className="overflow-hidden rounded-md border">
        <Table className="table-fixed">
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="w-32">状态</TableHead>
              <TableHead className="w-44">开始</TableHead>
              <TableHead className="w-44">结束</TableHead>
              <TableHead className="text-right">已启动</TableHead>
              <TableHead className="text-right">成功</TableHead>
              <TableHead className="text-right">失败</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {runs.map((run) => (
              <TableRow key={run.id}>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <History className="size-4 text-muted-foreground" />
                    {run.status}
                  </div>
                </TableCell>
                <TableCell>{formatTimestamp(run.startedAt)}</TableCell>
                <TableCell>{formatTimestamp(run.finishedAt)}</TableCell>
                <TableCell className="text-right">{run.totals.started}</TableCell>
                <TableCell className="text-right">{run.totals.success}</TableCell>
                <TableCell className="text-right">{run.totals.failed}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}

function formatTimestamp(value: string | undefined): string {
  if (!value) return "-"
  return value.replace("T", " ").slice(0, 16)
}
