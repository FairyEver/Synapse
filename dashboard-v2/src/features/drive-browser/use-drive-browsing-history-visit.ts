import { useEffect, useRef } from 'react'
import { createBrowserUuid } from '@/lib/browser-compat'
import { trackedDriveBrowserApi } from './shared/drive-telemetry-api'
import { trackDriveEvent } from './shared/drive-telemetry'

interface BrowsingHistoryVisitInput {
  readonly context: 'share' | 'owner'
  readonly shareId?: string
  readonly itemId?: string
  readonly ready: boolean
  /** Router history index is stable across password-removing replace navigation. */
  readonly navigationKey?: number
}
type Visit = { key: string; id: string; completed: boolean }

/** Each page navigation owns one event; refetches and effect replay reuse its ID. */
export function useDriveBrowsingHistoryVisit(input: BrowsingHistoryVisitInput): void {
  const visitRef = useRef<Visit | null>(null)
  const { context, shareId, itemId, ready, navigationKey } = input
  const key = JSON.stringify([context, shareId, itemId, navigationKey])
  useEffect(() => {
    if (context !== 'share' || !shareId || window.top !== window.self) {
      visitRef.current = null
      return
    }
    if (visitRef.current?.key !== key) visitRef.current = { key, id: createBrowserUuid(), completed: false }
    const visit = visitRef.current
    if (!ready) return
    let stop = reportVisit(shareId, itemId, visit)
    function onPageShow(event: PageTransitionEvent) {
      if (!event.persisted) return
      stop()
      const restoredVisit = { key, id: createBrowserUuid(), completed: false }
      visitRef.current = restoredVisit
      stop = reportVisit(shareId!, itemId, restoredVisit)
    }
    window.addEventListener('pageshow', onPageShow)
    return () => { stop(); window.removeEventListener('pageshow', onPageShow) }
  }, [context, shareId, itemId, key, ready])
}

function reportVisit(shareId: string, itemId: string | undefined, visit: Visit): () => void {
  const controller = new AbortController()
  let retryTimer: ReturnType<typeof setTimeout> | undefined
  async function record(retry: boolean): Promise<void> {
    try {
      await trackedDriveBrowserApi.recordShareVisit(shareId, itemId, { visitId: visit.id }, controller.signal)
      if (!controller.signal.aborted) visit.completed = true
    } catch {
      if (controller.signal.aborted) return
      trackDriveEvent({ eventKey: 'web.drive.history.record', component: 'browsing-history', category: 'error', action: 'complete', outcome: 'failure' })
      // A retry keeps the event identity even when the server committed before the connection failed.
      if (retry) retryTimer = setTimeout(() => { void record(false) }, 1_000)
    }
  }
  if (!visit.completed) void record(true)
  return () => { controller.abort(); if (retryTimer !== undefined) clearTimeout(retryTimer) }
}
