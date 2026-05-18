import { Square, Clock, AlertCircle, ArrowLeft, CheckCircle, XCircle } from 'lucide-react'
import type { SchedulerSnapshot, OutputLine } from '../types'
import { WorkerGrid } from '../components/worker-grid'

interface RunViewProps {
  snapshot: SchedulerSnapshot
  outputLines: ReadonlyMap<number, OutputLine[]>
  trimmed: ReadonlyMap<number, number>
  onStop: () => void
  onBack: () => void
}

const statusLabels: Record<string, string> = {
  idle: '空闲',
  running: '运行中',
  waiting: '等待下一批',
  stopping: '停止中…',
  stopped: '已停止',
  error: '错误',
}

function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000)
  const m = Math.floor(s / 60)
  if (m === 0) return `${s}s`
  return `${m}m ${s % 60}s`
}

const batchStatusIcon: Record<string, { icon: typeof CheckCircle; className: string }> = {
  success: { icon: CheckCircle, className: 'text-green-500' },
  partial: { icon: AlertCircle, className: 'text-orange-500' },
  error:   { icon: XCircle,     className: 'text-destructive' },
}

export function RunView({ snapshot, outputLines, trimmed, onStop, onBack }: RunViewProps) {
  const batch = snapshot.currentBatch
  const displayBatch = batch ?? snapshot.lastBatch
  const canStop = snapshot.status === 'running' || snapshot.status === 'waiting'
  const isFinished = !canStop && !batch

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          {isFinished && (
            <button
              type="button"
              onClick={onBack}
              className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              返回配置
            </button>
          )}
          <span className="text-sm font-medium">
            {statusLabels[snapshot.status] ?? snapshot.status}
          </span>
          {displayBatch && (
            <span className="text-xs text-muted-foreground flex items-center gap-1">
              <Clock className="h-3 w-3" />
              {formatDuration(displayBatch.durationMs)}
            </span>
          )}
        </div>
        {canStop && (
          <button
            type="button"
            onClick={onStop}
            className="flex items-center gap-1.5 bg-destructive text-white rounded-md py-1.5 px-3 text-sm font-medium hover:opacity-90 transition-opacity"
          >
            <Square className="h-3.5 w-3.5" />
            当前批次后停止
          </button>
        )}
        {isFinished && !canStop && (
          <button
            type="button"
            onClick={onBack}
            className="flex items-center gap-1.5 border border-border rounded-md py-1.5 px-3 text-sm font-medium hover:bg-muted transition-colors"
          >
            返回配置
          </button>
        )}
      </div>

      {isFinished && displayBatch && (
        <BatchSummary batch={displayBatch} />
      )}

      {snapshot.error && (
        <div className="flex items-center gap-2 text-destructive text-sm bg-destructive/10 rounded-md p-3">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {snapshot.error}
        </div>
      )}

      {displayBatch && (
        <WorkerGrid
          workers={displayBatch.workers}
          outputLines={outputLines}
          trimmed={trimmed}
        />
      )}
    </div>
  )
}

function BatchSummary({ batch }: { batch: { status: string; durationMs: number; workers: Array<{ status: string }> } }) {
  const cfg = batchStatusIcon[batch.status] ?? batchStatusIcon.error
  const Icon = cfg.icon
  const successCount = batch.workers.filter(w => w.status === 'success').length
  const errorCount = batch.workers.filter(w => w.status === 'error' || w.status === 'timeout').length

  return (
    <div className="flex items-center gap-3 rounded-lg border border-border bg-muted/50 p-3">
      <Icon className={`h-5 w-5 ${cfg.className}`} />
      <div className="text-sm">
        <span className="font-medium">
          {batch.status === 'success' ? '全部成功' : batch.status === 'partial' ? '部分成功' : '执行失败'}
        </span>
        <span className="text-muted-foreground ml-2">
          {successCount}/{batch.workers.length} 成功
          {errorCount > 0 ? ` · ${errorCount} 失败` : ''}
          {' · '}{formatDuration(batch.durationMs)}
        </span>
      </div>
    </div>
  )
}
