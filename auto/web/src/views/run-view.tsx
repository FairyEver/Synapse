import { Square, Clock, AlertCircle, ArrowLeft } from 'lucide-react'
import type { SchedulerSnapshot, OutputLine, RunTotals } from '../types'
import { WorkerGrid } from '../components/worker-grid'

interface RunViewProps {
  snapshot: SchedulerSnapshot
  outputLines: ReadonlyMap<string, OutputLine[]>
  trimmed: ReadonlyMap<string, number>
  outputLoadError: string | null
  onReloadOutput: () => void
  onStop: () => void
  onBack: () => void
}

const statusLabels: Record<string, string> = {
  idle: '空闲',
  running: '运行中',
  draining: '停止中',
  stopped: '已停止',
  error: '错误',
}

function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000)
  const m = Math.floor(s / 60)
  if (m === 0) return `${s}s`
  return `${m}m ${s % 60}s`
}

export function RunView({
  snapshot,
  outputLines,
  trimmed,
  outputLoadError,
  onReloadOutput,
  onStop,
  onBack,
}: RunViewProps) {
  const session = snapshot.session
  const canStop = snapshot.status === 'running'
  const isFinished = snapshot.status === 'stopped' || snapshot.status === 'error'

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
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
          {session && (
            <span className="text-xs text-muted-foreground flex items-center gap-1">
              <Clock className="h-3 w-3" />
              {formatDuration(session.durationMs)}
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
            当前任务后停止
          </button>
        )}
        {isFinished && (
          <button
            type="button"
            onClick={onBack}
            className="flex items-center gap-1.5 border border-border rounded-md py-1.5 px-3 text-sm font-medium hover:bg-muted transition-colors"
          >
            返回配置
          </button>
        )}
      </div>

      {session && <SessionSummary totals={session.totals} />}

      {snapshot.error && (
        <div className="flex items-center gap-2 text-destructive text-sm bg-destructive/10 rounded-md p-3">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {snapshot.error}
        </div>
      )}

      {outputLoadError && (
        <div className="flex items-center gap-2 text-destructive text-sm bg-destructive/10 rounded-md p-3">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>{outputLoadError}</span>
          <button
            type="button"
            onClick={onReloadOutput}
            className="ml-auto rounded-md border border-border px-2 py-1 text-xs font-medium text-foreground hover:bg-background transition-colors"
          >
            重试
          </button>
        </div>
      )}

      {session && (
        <WorkerGrid
          slots={session.slots}
          outputLines={outputLines}
          trimmed={trimmed}
        />
      )}
    </div>
  )
}

function SessionSummary({ totals }: { totals: RunTotals }) {
  return (
    <div className="flex items-center gap-4 rounded-lg border border-border bg-muted/50 p-3 text-sm">
      <span><span className="font-medium">{totals.started}</span> 已启动</span>
      <span className="text-muted-foreground">{totals.success} 成功</span>
      <span className="text-muted-foreground">{totals.error} 失败</span>
      <span className="text-muted-foreground">{totals.timeout} 超时</span>
    </div>
  )
}
