import { useCallback, useRef, useState } from 'react'
import type { OutputLine } from '../types'

const MAX_LINES_PER_WORKER = 2000

export interface OutputBufferState {
  lines: ReadonlyMap<string, OutputLine[]>
  trimmed: ReadonlyMap<string, number>
}

export interface OutputBufferActions {
  append: (line: OutputLine) => void
  reset: () => void
  load: (workers: Record<string, OutputLine[]>) => void
}

function lineKey(line: OutputLine): string {
  return line.sequence === undefined ? String(line.workerId) : `${line.workerId}:${line.sequence}`
}

export function useOutputBuffer(): OutputBufferState & OutputBufferActions {
  const linesRef = useRef(new Map<string, OutputLine[]>())
  const trimmedRef = useRef(new Map<string, number>())
  const [, setTick] = useState(0)

  const flush = useCallback(() => setTick(t => t + 1), [])

  const append = useCallback((line: OutputLine) => {
    const key = lineKey(line)
    let bucket = linesRef.current.get(key)
    if (!bucket) {
      bucket = []
      linesRef.current.set(key, bucket)
    }
    bucket.push(line)
    if (bucket.length > MAX_LINES_PER_WORKER) {
      const excess = bucket.length - MAX_LINES_PER_WORKER
      bucket.splice(0, excess)
      trimmedRef.current.set(
        key,
        (trimmedRef.current.get(key) ?? 0) + excess,
      )
    }
    flush()
  }, [flush])

  const reset = useCallback(() => {
    linesRef.current = new Map()
    trimmedRef.current = new Map()
    flush()
  }, [flush])

  const load = useCallback((workers: Record<string, OutputLine[]>) => {
    const next = new Map<string, OutputLine[]>()
    for (const [id, lines] of Object.entries(workers)) {
      next.set(id, lines)
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
