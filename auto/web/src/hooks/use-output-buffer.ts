import { useCallback, useRef, useState } from 'react'
import type { OutputLine } from '../types'

const MAX_LINES_PER_WORKER = 2000

export interface OutputBufferState {
  lines: ReadonlyMap<number, OutputLine[]>
  trimmed: ReadonlyMap<number, number>
}

export interface OutputBufferActions {
  append: (line: OutputLine) => void
  reset: () => void
  load: (workers: Record<number, OutputLine[]>) => void
}

export function useOutputBuffer(): OutputBufferState & OutputBufferActions {
  const linesRef = useRef(new Map<number, OutputLine[]>())
  const trimmedRef = useRef(new Map<number, number>())
  const [, setTick] = useState(0)

  const flush = useCallback(() => setTick(t => t + 1), [])

  const append = useCallback((line: OutputLine) => {
    let bucket = linesRef.current.get(line.workerId)
    if (!bucket) {
      bucket = []
      linesRef.current.set(line.workerId, bucket)
    }
    bucket.push(line)
    if (bucket.length > MAX_LINES_PER_WORKER) {
      const excess = bucket.length - MAX_LINES_PER_WORKER
      bucket.splice(0, excess)
      trimmedRef.current.set(
        line.workerId,
        (trimmedRef.current.get(line.workerId) ?? 0) + excess,
      )
    }
    flush()
  }, [flush])

  const reset = useCallback(() => {
    linesRef.current = new Map()
    trimmedRef.current = new Map()
    flush()
  }, [flush])

  const load = useCallback((workers: Record<number, OutputLine[]>) => {
    const next = new Map<number, OutputLine[]>()
    for (const [id, lines] of Object.entries(workers)) {
      next.set(Number(id), lines)
    }
    linesRef.current = next
    trimmedRef.current = new Map()
    flush()
  }, [flush])

  return {
    lines: linesRef.current,
    trimmed: trimmedRef.current,
    append,
    reset,
    load,
  }
}
