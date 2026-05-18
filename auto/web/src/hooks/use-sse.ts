import { useEffect, useRef } from 'react'
import type { SchedulerSnapshot, OutputLine } from '../types'
import type { OutputBufferActions } from './use-output-buffer'

interface UseSSEOptions {
  onSnapshot: (snapshot: SchedulerSnapshot) => void
  buffer: OutputBufferActions
}

export function useSSE({ onSnapshot, buffer }: UseSSEOptions): void {
  const onSnapshotRef = useRef(onSnapshot)
  onSnapshotRef.current = onSnapshot
  const bufferRef = useRef(buffer)
  bufferRef.current = buffer

  useEffect(() => {
    let es: EventSource | null = null
    let retryTimer: ReturnType<typeof setTimeout> | null = null

    function connect() {
      es = new EventSource('/events')

      es.addEventListener('snapshot', (e: MessageEvent) => {
        try {
          const snapshot = JSON.parse(e.data) as SchedulerSnapshot
          onSnapshotRef.current(snapshot)
        } catch { /* ignore malformed */ }
      })

      es.addEventListener('output', (e: MessageEvent) => {
        try {
          const line = JSON.parse(e.data) as OutputLine
          bufferRef.current.append(line)
        } catch { /* ignore malformed */ }
      })

      es.onerror = () => {
        es?.close()
        retryTimer = setTimeout(connect, 3000)
      }
    }

    connect()

    return () => {
      es?.close()
      if (retryTimer) clearTimeout(retryTimer)
    }
  }, [])
}
