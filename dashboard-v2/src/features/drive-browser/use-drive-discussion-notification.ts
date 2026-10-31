import { useEffect, useRef, useState } from 'react'
import { parseDriveDiscussionFragment } from '@synapse/shared'
import { discussionNotificationApi } from '@/lib/api'
import { useAuthStore } from '@/stores/auth-store'

const navigateBrowser = (url: string) => window.location.assign(url)
type State = { status: 'loading' | 'error' | 'unavailable' | 'ready'; error: string | null }

export function isDiscussionBrowserTarget(value: string): boolean {
  if (!value.startsWith('/') || value.startsWith('//') || value.includes('\\')) return false
  const url = new URL(value, window.location.origin)
  const id = '[A-Za-z0-9_-]{1,120}'
  return url.origin === window.location.origin && !url.search
    && new RegExp(`^(?:/drive/items/${id}|/share/${id}(?:/items/${id})?)$`, 'u').test(url.pathname)
    && parseDriveDiscussionFragment(url.hash) !== null
}

export function useDriveDiscussionNotification(id: string, navigate = navigateBrowser) {
  const sessionId = useAuthStore((state) => state.auth.user?.sessionId)
  const [attempt, setAttempt] = useState(0)
  const [state, setState] = useState<State>({ status: 'loading', error: null })
  const generation = useRef(0)
  const navigateRef = useRef(navigate)
  navigateRef.current = navigate
  useEffect(() => {
    const request = ++generation.current
    const current = () => request === generation.current && Boolean(sessionId) && useAuthStore.getState().auth.user?.sessionId === sessionId
    if (!sessionId) return
    setState({ status: 'loading', error: null })
    void (async () => {
      try {
        const notification = await discussionNotificationApi.get(id)
        if (!current()) return
        if (notification.id !== id || notification.source !== 'drive-discussion') throw new Error('INVALID_NOTIFICATION')
        await discussionNotificationApi.markRead(id)
        if (!current()) return
        const target = await discussionNotificationApi.resolveTarget(id)
        if (!current()) return
        if (target.status === 'unavailable') { setState({ status: 'unavailable', error: '文档已删除或无法访问' }); return }
        if (target.status !== 'ready' || !isDiscussionBrowserTarget(target.browserUrl)) throw new Error('INVALID_TARGET')
        setState({ status: 'ready', error: null })
        navigateRef.current(target.browserUrl)
      } catch {
        if (current()) setState({ status: 'error', error: '无法打开通知' })
      }
    })()
    return () => { generation.current += 1 }
  }, [attempt, id, sessionId])
  return { ...state, retry: () => setAttempt((value) => value + 1) }
}
