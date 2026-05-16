import { Square, Clock, AlertCircle } from 'lucide-react'
import type { SchedulerSnapshot, OutputLine } from '../types'
import { WorkerGrid } from '../components/worker-grid'

interface RunViewProps {
  snapshot: SchedulerSnapshot
  outputLines: ReadonlyMap<number, OutputLine[]>
  trimmed: ReadonlyMap<number, number>
  onStop: () => void
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

export function RunView({ snapshot, outputLines, trimmed, onStop }: RunViewProps) {
  const batch = snapshot.currentBatch
  const canStop = snapshot.status === 'running' || snapshot.status === 'waiting'

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-sm font-medium">
            {statusLabels[snapshot.status] ?? snapshot.status}
          </span>
          {batch && (
            <span className="text-xs text-muted-foreground flex items-center gap-1">
              <Clock className="h-3 w-3" />
              {formatDuration(batch.durationMs)}
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
      </div>

      {snapshot.error && (
        <div className="flex items-center gap-2 text-destructive text-sm bg-destructive/10 rounded-md p-3">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {snapshot.error}
        </div>
      )}

      {batch && (
        <WorkerGrid
          workers={batch.workers}
          outputLines={outputLines}
          trimmed={trimmed}
        />
      )}

      {snapshot.lastBatch && !batch && (
        <div className="text-sm text-muted-foreground">
          上次批次: {snapshot.lastBatch.status} — {formatDuration(snapshot.lastBatch.durationMs)}
        </div>
      )}
    </div>
  )
}
