import { useCallback, useRef, useState } from 'react'
import { desktopUpdateApi } from '@/lib/desktop-update-api'

export type UpdateHandoffState = 'idle' | 'requesting' | 'opened' | 'error'

export function useUpdateHandoff() {
  const [state, setState] = useState<UpdateHandoffState>('idle')
  const requestPendingRef = useRef(false)

  const requestUpdate = useCallback(async () => {
    if (requestPendingRef.current) return
    requestPendingRef.current = true
    setState('requesting')

    try {
      const result = await desktopUpdateApi.issueIntent()
      if (typeof result.deepLink !== 'string') throw new Error('Invalid update intent response')

      window.open(result.deepLink, '_self')
      setState('opened')
    } catch {
      setState('error')
    } finally {
      requestPendingRef.current = false
    }
  }, [])

  return { requestUpdate, state }
}
