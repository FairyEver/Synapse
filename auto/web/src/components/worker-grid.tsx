import type { WorkerResult, OutputLine } from '../types'
import { WorkerPanel } from './worker-panel'

interface WorkerGridProps {
  workers: WorkerResult[]
  outputLines: ReadonlyMap<number, OutputLine[]>
  trimmed: ReadonlyMap<number, number>
}

export function WorkerGrid({ workers, outputLines, trimmed }: WorkerGridProps) {
  if (workers.length === 0) return null

  return (
    <div className="space-y-2">
      {workers.map(worker => (
        <WorkerPanel
          key={worker.id}
          worker={worker}
          lines={outputLines.get(worker.id) ?? []}
          trimmedCount={trimmed.get(worker.id) ?? 0}
          defaultOpen={workers.length <= 3}
        />
      ))}
    </div>
  )
}
