import type { SlotSnapshot, OutputLine } from '../types'
import { WorkerPanel } from './worker-panel'

interface WorkerGridProps {
  slots: SlotSnapshot[]
  outputLines: ReadonlyMap<string, OutputLine[]>
  trimmed: ReadonlyMap<string, number>
}

function slotKey(slot: SlotSnapshot): string {
  return `${slot.slotId}:${slot.sequence}`
}

export function WorkerGrid({ slots, outputLines, trimmed }: WorkerGridProps) {
  if (slots.length === 0) return null

  return (
    <div className="space-y-2">
      {slots.map(slot => {
        const key = slotKey(slot)
        return (
          <WorkerPanel
            key={slot.slotId}
            worker={slot.worker}
            label={`Slot ${slot.slotId}`}
            lines={outputLines.get(key) ?? []}
            trimmedCount={trimmed.get(key) ?? 0}
            defaultOpen={slots.length <= 3}
          />
        )
      })}
    </div>
  )
}
