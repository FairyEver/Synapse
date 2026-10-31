import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useState, type RefObject } from 'react'
import { parseDriveDiscussionFragment, type DriveDiscussionLocation } from '@synapse/shared'
import { useAuthStore } from '@/stores/auth-store'

export function useDriveDiscussionLocation(itemId: string) {
  const [location, setLocation] = useState<DriveDiscussionLocation | null>(() => parseDriveDiscussionFragment(window.location.hash))
  const [requestKey, setRequestKey] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const consume = useCallback(() => setLocation(null), [])
  const unavailable = useCallback((message: string) => { setError(message); setLocation(null) }, [])
  useEffect(() => {
    const read = () => { setLocation(parseDriveDiscussionFragment(window.location.hash)); setError(null); setRequestKey((value) => value + 1) }
    read()
    window.addEventListener('hashchange', read)
    window.addEventListener('popstate', read)
    const unsubscribe = useAuthStore.subscribe(() => { setLocation(null); setRequestKey((value) => value + 1) })
    return () => { window.removeEventListener('hashchange', read); window.removeEventListener('popstate', read); unsubscribe() }
  }, [itemId])
  return { location, requestKey: `${itemId}:${requestKey}`, error, consume, cancel: consume, unavailable }
}
export const DriveDiscussionLocationContext = createContext<ReturnType<typeof useDriveDiscussionLocation> | null>(null)
export const usePendingDriveDiscussion = () => useContext(DriveDiscussionLocationContext)

export function useDiscussionTargetFocus(ref: RefObject<HTMLElement | null>, matches: boolean) {
  const pending = usePendingDriveDiscussion()
  const request = pending?.requestKey
  const consume = pending?.consume
  useLayoutEffect(() => {
    if (!matches || !consume) return
    const frame = window.requestAnimationFrame(() => {
      const element = ref.current
      if (!element) return
      element.scrollIntoView?.({ block: 'nearest' })
      element.focus({ preventScroll: true })
      consume()
    })
    return () => window.cancelAnimationFrame(frame)
  }, [consume, matches, ref, request])
}
