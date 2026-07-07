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
import { formatRunStatus, formatTimestamp } from "../swarm-task-format"

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
    <div className="flex h-full min-h-0 flex-col gap-3 p-4">
      <div className="max-h-96 overflow-auto rounded-lg border bg-card">
        <Table className="table-fixed">
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="sticky top-0 z-10 w-28 bg-card">状态</TableHead>
              <TableHead className="sticky top-0 z-10 w-44 bg-card">开始</TableHead>
              <TableHead className="sticky top-0 z-10 w-44 bg-card">结束</TableHead>
              <TableHead className="sticky top-0 z-10 w-20 bg-card text-right">已启动</TableHead>
              <TableHead className="sticky top-0 z-10 w-20 bg-card text-right">成功</TableHead>
              <TableHead className="sticky top-0 z-10 w-20 bg-card text-right">失败</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {runs.map((run) => (
              <TableRow key={run.id}>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <History className="size-4 shrink-0 text-muted-foreground" />
                    {formatRunStatus(run.status)}
                  </div>
                </TableCell>
                <TableCell className="tabular-nums">{formatTimestamp(run.startedAt)}</TableCell>
                <TableCell className="tabular-nums">{formatTimestamp(run.finishedAt)}</TableCell>
                <TableCell className="text-right tabular-nums">{run.totals.started}</TableCell>
                <TableCell className="text-right tabular-nums">{run.totals.success}</TableCell>
                <TableCell className="text-right tabular-nums">{run.totals.failed}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <div className="flex shrink-0 items-center justify-end">
        <Button
          type="button"
          variant="outline"
          className="transition-transform active:scale-[0.96]"
          onClick={onStartRun}
        >
          <RotateCcw data-icon="inline-start" />
          再运行当前任务
        </Button>
      </div>
    </div>
  )
}
