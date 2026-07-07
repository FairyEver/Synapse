import { ExternalLink, RefreshCw, Square, StopCircle } from "lucide-react"
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
import type { SwarmRun, SwarmRunStatus, SwarmWorkerRun } from "../../shared/schema"

type SwarmRunPanelProps = {
  readonly run: SwarmRun | null
  readonly workers: readonly SwarmWorkerRun[]
  readonly loading: boolean
  readonly onRefresh: () => void
  readonly onStopRefill: () => void
  readonly onCancelRun: () => void
  readonly onOpenConversation: (worker: SwarmWorkerRun) => void
}

const terminalRunStatuses = new Set<SwarmRunStatus>(["success", "partial", "failed", "cancelled"])

export function SwarmRunPanel({
  run,
  workers,
  loading,
  onRefresh,
  onStopRefill,
  onCancelRun,
  onOpenConversation,
}: SwarmRunPanelProps) {
  if (!run) {
    return (
      <Empty className="min-h-64 border-0">
        <EmptyHeader>
          <EmptyTitle>暂无运行</EmptyTitle>
        </EmptyHeader>
      </Empty>
    )
  }

  return (
    <div className="grid h-full min-h-0 gap-4 p-4 sm:p-5">
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" onClick={onRefresh} disabled={loading}>
          <RefreshCw data-icon="inline-start" />
          刷新
        </Button>
        <Button type="button" variant="outline" onClick={onStopRefill} disabled={loading || run.stopRequested}>
          <StopCircle data-icon="inline-start" />
          停止补位
        </Button>
        <Button type="button" variant="outline" onClick={onCancelRun} disabled={loading || terminalRunStatuses.has(run.status)}>
          <Square data-icon="inline-start" />
          取消运行
        </Button>
        <div className="text-sm text-muted-foreground">
          {run.status} / {run.totals.started} workers
        </div>
      </div>

      <div className="overflow-hidden rounded-md border">
        <Table className="table-fixed">
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="w-20">Worker</TableHead>
              <TableHead className="w-20">轮次</TableHead>
              <TableHead className="w-28">状态</TableHead>
              <TableHead className="w-28">阶段</TableHead>
              <TableHead>消息</TableHead>
              <TableHead className="w-28 text-right">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {workers.map((worker) => (
              <TableRow key={worker.id}>
                <TableCell>{worker.workerIndex}</TableCell>
                <TableCell>{worker.roundIndex}</TableCell>
                <TableCell>{worker.status}</TableCell>
                <TableCell>{worker.lastPhase ?? "-"}</TableCell>
                <TableCell className="truncate">{worker.lastMessage ?? "-"}</TableCell>
                <TableCell className="text-right">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-label="打开会话"
                    disabled={!worker.conversationId}
                    onClick={() => onOpenConversation(worker)}
                  >
                    <ExternalLink />
                    打开会话
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
