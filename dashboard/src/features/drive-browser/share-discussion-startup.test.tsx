// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { driveAnnotationApi, driveMessageApi } from '@/lib/api'
import { useAuthStore } from '@/stores/auth-store'
import { useDriveAnnotations } from './use-drive-annotations'
import { useDriveMessages } from './use-drive-messages'
import { useDriveDiscussionLocation } from './use-drive-discussion-location'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
afterEach(() => { vi.restoreAllMocks(); history.replaceState(null, '', '/') })

describe('discussion fragments during public share startup', () => {
  it.each(['annotation', 'message'] as const)('preserves a %s target until the first session and discussion requests settle', async (kind) => {
    useAuthStore.setState((state) => ({ auth: { ...state.auth, initialized: false, user: null, isAuthenticated: false } }))
    history.replaceState(null, '', `/share/link#discussion=${kind}&${kind === 'annotation' ? 'threadId=thread&commentId=comment' : 'messageId=message'}`)
    const annotationRead = vi.spyOn(driveAnnotationApi, 'listShare').mockResolvedValue([])
    const messageRead = vi.spyOn(driveMessageApi, 'list').mockResolvedValue({ itemId: 'doc', canPost: false, messages: [] })
    function View() {
      const location = useDriveDiscussionLocation('doc')
      const annotations = useDriveAnnotations({ context: 'share', shareId: 'link' })
      const messages = useDriveMessages({ context: 'share', shareId: 'link' })
      return <output data-loading={(kind === 'annotation' ? annotations.loading : messages.loading) ? 'yes' : 'no'}>{location.location?.kind ?? 'consumed'}</output>
    }
    const host = document.createElement('div'); document.body.append(host)
    const root = createRoot(host)
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    try {
      await act(async () => root.render(<QueryClientProvider client={client}><View /></QueryClientProvider>))
      expect(host.textContent).toBe(kind)
      expect(host.querySelector('output')?.dataset.loading).toBe('yes')
      expect(annotationRead).not.toHaveBeenCalled()
      expect(messageRead).not.toHaveBeenCalled()
      await act(async () => { useAuthStore.getState().auth.setUser(null); await new Promise((resolve) => setTimeout(resolve, 20)) })
      expect(host.textContent).toBe(kind)
      expect(annotationRead).toHaveBeenCalledTimes(1)
      expect(messageRead).toHaveBeenCalledTimes(1)
      await act(async () => useAuthStore.getState().auth.reset())
      expect(host.textContent).toBe('consumed')
    } finally { await act(async () => root.unmount()); client.clear(); host.remove() }
  })
})
