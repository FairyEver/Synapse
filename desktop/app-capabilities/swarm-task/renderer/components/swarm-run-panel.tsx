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
import { formatRunStatus, formatRunTotals, formatWorkerPhase, formatWorkerStatus } from "../swarm-task-format"

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
    <div className="flex h-full min-h-0 flex-col gap-3 p-4">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-3">
        <div className="min-w-0 text-sm">
          <span className="font-medium text-foreground">{formatRunStatus(run.status)}</span>
          <span className="ml-3 text-muted-foreground tabular-nums">{formatRunTotals(run)}</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            className="transition-transform active:scale-[0.96]"
            onClick={onRefresh}
            disabled={loading}
          >
            <RefreshCw data-icon="inline-start" className={loading ? "animate-spin" : undefined} />
            刷新
          </Button>
          <Button
            type="button"
            variant="outline"
            className="transition-transform active:scale-[0.96]"
            onClick={onStopRefill}
            disabled={loading || run.stopRequested}
          >
            <StopCircle data-icon="inline-start" />
            停止补位
          </Button>
          <Button
            type="button"
            variant="outline"
            className="transition-transform active:scale-[0.96]"
            onClick={onCancelRun}
            disabled={loading || terminalRunStatuses.has(run.status)}
          >
            <Square data-icon="inline-start" />
            取消运行
          </Button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto rounded-lg border bg-card">
        <Table className="table-fixed">
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="sticky top-0 z-10 w-20 bg-card text-right">Worker</TableHead>
              <TableHead className="sticky top-0 z-10 w-20 bg-card text-right">轮次</TableHead>
              <TableHead className="sticky top-0 z-10 w-28 bg-card">状态</TableHead>
              <TableHead className="sticky top-0 z-10 w-28 bg-card">阶段</TableHead>
              <TableHead className="sticky top-0 z-10 bg-card">消息</TableHead>
              <TableHead className="sticky top-0 z-10 w-28 bg-card text-right">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {workers.map((worker) => (
              <TableRow key={worker.id}>
                <TableCell className="text-right tabular-nums">{worker.workerIndex}</TableCell>
                <TableCell className="text-right tabular-nums">{worker.roundIndex}</TableCell>
                <TableCell>{formatWorkerStatus(worker.status)}</TableCell>
                <TableCell>{formatWorkerPhase(worker.lastPhase)}</TableCell>
                <TableCell className="truncate">{worker.lastMessage ?? "-"}</TableCell>
                <TableCell className="text-right">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="transition-transform active:scale-[0.96]"
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
