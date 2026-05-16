import { useState } from 'react'
import { ChevronRight, CheckCircle, XCircle, Clock, Loader2, Circle } from 'lucide-react'
import type { WorkerResult, OutputLine } from '../types'
import { Terminal } from './terminal'
import { cn } from '../lib/utils'

interface WorkerPanelProps {
  worker: WorkerResult
  lines: OutputLine[]
  trimmedCount: number
  defaultOpen?: boolean
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  const s = Math.floor(ms / 1000)
  const m = Math.floor(s / 60)
  if (m === 0) return `${s}s`
  return `${m}m ${s % 60}s`
}

const statusConfig: Record<string, { icon: typeof Circle; color: string; iconExtra?: string; label: string }> = {
  pending:  { icon: Circle,      color: 'text-muted-foreground', label: '等待中' },
  running:  { icon: Loader2,     color: 'text-blue-500', iconExtra: 'animate-spin', label: '运行中' },
  success:  { icon: CheckCircle, color: 'text-green-500', label: '成功' },
  error:    { icon: XCircle,     color: 'text-destructive', label: '失败' },
  timeout:  { icon: Clock,       color: 'text-orange-500', label: '超时' },
}

export function WorkerPanel({ worker, lines, trimmedCount, defaultOpen = false }: WorkerPanelProps) {
  const [open, setOpen] = useState(defaultOpen)
  const cfg = statusConfig[worker.status] ?? statusConfig.pending
  const Icon = cfg.icon

  return (
    <div className="border border-border rounded-lg overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-2 w-full px-3 py-2 text-sm hover:bg-muted/50 transition-colors"
      >
        <ChevronRight className={cn('h-4 w-4 transition-transform', open && 'rotate-90')} />
        <Icon className={cn('h-4 w-4', cfg.color, cfg.iconExtra)} />
        <span className="font-medium">Worker {worker.id}</span>
        <span className={cn('text-xs', cfg.color)}>{cfg.label}</span>
        {worker.durationMs > 0 && (
          <span className="text-xs text-muted-foreground ml-auto">
            {formatDuration(worker.durationMs)}
          </span>
        )}
      </button>
      {open && (
        <div className="h-64">
          {lines.length > 0 ? (
            <Terminal lines={lines} trimmedCount={trimmedCount} className="h-full" />
          ) : (
            <div className="h-full bg-terminal-bg flex items-center justify-center text-terminal-fg/50 text-xs font-mono">
              {worker.lastMessage || '暂无输出'}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
