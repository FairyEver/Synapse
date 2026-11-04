// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { expect, it, vi } from 'vitest'
import { useAuthStore } from '@/stores/auth-store'
import { skillHubApi } from './skill-hub-api'
import { checkHubIntent, listHubIntents, useSkillPublish } from './use-skill-publish'

it('can find an unknown write after relogin to the original account without showing it to another account', async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  const host = document.createElement('div'), root = createRoot(host)
  const action = 'app.skill_hub.skill.create'
  const auth = useAuthStore.getState().auth
  const user = (userId: string, sessionId: string) => ({ userId, sessionId, email: 'fixture@example.test', handle: 'fixture' })
  const send = vi.fn().mockRejectedValue(new TypeError('lost'))
  const lookup = vi.spyOn(skillHubApi, 'receipt').mockImplementation(async (_session, request) => ({
    ...request, status: 'not_found', resultAccessible: false,
  }))
  let submit: ReturnType<typeof useSkillPublish>['submit'] | undefined
  function Writer() {
    submit = useSkillPublish({ action, session: 'session_a', target: 'new', onCommitted: vi.fn() }).submit
    return null
  }
  try {
    auth.setUser(user('account_a', 'session_a'))
    await act(async () => root.render(<QueryClientProvider client={new QueryClient()}><Writer /></QueryClientProvider>))
    await act(async () => { await submit?.(async () => send) })
    const requestId = send.mock.calls[0]?.[0]
    expect(requestId).toBeTruthy()
    await act(async () => root.unmount())
    auth.setUser(user('account_b', 'session_b'))
    expect(listHubIntents('session_b')).toEqual([])
    auth.setUser(user('account_a', 'session_a_again'))
    const pending = listHubIntents('session_a_again')
    expect(pending).toMatchObject([{ request: { action, requestId } }])
    await checkHubIntent('session_a_again', pending[0])
    expect(lookup).toHaveBeenLastCalledWith('session_a_again', { action, requestId })
  } finally { lookup.mockRestore(); auth.reset(); localStorage.clear(); sessionStorage.clear() }
})
