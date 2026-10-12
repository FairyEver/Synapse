// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import { useAuthStore } from '@/stores/auth-store'
const api = vi.hoisted(() => ({ get: vi.fn(), markRead: vi.fn(), resolveTarget: vi.fn() }))
vi.mock('@/lib/api', () => ({ discussionNotificationApi: api }))
;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
afterEach(() => { vi.resetAllMocks(); useAuthStore.getState().auth.reset() })
function pending<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((done) => { resolve = done }); return { promise, resolve } }
async function mount() {
  useAuthStore.getState().auth.setUser({ email: 'user@example.com', handle: 'user', sessionId: 'session-1' })
  const { useDriveDiscussionNotification } = await import('./use-drive-discussion-notification')
  const navigate = vi.fn()
  const host = document.createElement('div'); document.body.append(host)
  const root = createRoot(host)
  function Probe() { const state = useDriveDiscussionNotification('n-1', navigate); return <p>{state.status}:{state.error}</p> }
  await act(async () => root.render(<Probe />))
  return { navigate, host, close: async () => { await act(async () => root.unmount()); host.remove() } }
}
it('reads the current notification, marks read, and resolves before navigating', async () => {
  const order: string[] = []
  api.get.mockImplementation(async () => { order.push('get'); return { id: 'n-1', source: 'drive-discussion' } })
  api.markRead.mockImplementation(async () => { order.push('read'); return { ok: true } })
  api.resolveTarget.mockImplementation(async () => { order.push('target'); return { status: 'ready', browserUrl: '/drive/items/file#discussion=message&messageId=m' } })
  const probe = await mount()
  try { expect(order).toEqual(['get', 'read', 'target']); expect(probe.navigate).toHaveBeenCalledWith('/drive/items/file#discussion=message&messageId=m') } finally { await probe.close() }
})
it('read failure stops target resolution and navigation', async () => {
  api.get.mockResolvedValue({ id: 'n-1', source: 'drive-discussion' }); api.markRead.mockRejectedValue(new Error('secret'))
  const probe = await mount()
  try { expect(probe.host.textContent).toBe('error:无法打开通知'); expect(api.resolveTarget).not.toHaveBeenCalled(); expect(probe.navigate).not.toHaveBeenCalled() } finally { await probe.close() }
})
it.each(['https://outside.example/a', '//outside.example/a', '/share/x?password=secret#discussion=message&messageId=m', '/settings', '/share/x#discussion=message&messageId=%2F'])('rejects unsafe or unrelated navigation %s', async (browserUrl) => {
  api.get.mockResolvedValue({ id: 'n-1', source: 'drive-discussion' }); api.markRead.mockResolvedValue({ ok: true }); api.resolveTarget.mockResolvedValue({ status: 'ready', browserUrl })
  const probe = await mount()
  try { expect(probe.navigate).not.toHaveBeenCalled(); expect(probe.host.textContent).toContain('error:') } finally { await probe.close() }
})
it.each(['switch', 'same-account-relogin', 'cancel'])('%s invalidates a late target result', async (scenario) => {
  const target = pending<unknown>()
  api.get.mockResolvedValue({ id: 'n-1', source: 'drive-discussion' }); api.markRead.mockResolvedValue({ ok: true }); api.resolveTarget.mockReturnValueOnce(target.promise).mockImplementation(() => new Promise(() => {}))
  const probe = await mount()
  if (scenario === 'cancel') await probe.close()
  else await act(async () => { useAuthStore.getState().auth.setUser({ email: scenario === 'switch' ? 'other@example.com' : 'user@example.com', handle: 'user', sessionId: 'session-2' }) })
  await act(async () => target.resolve({ status: 'ready', browserUrl: '/drive/items/file#discussion=message&messageId=m' }))
  expect(probe.navigate).not.toHaveBeenCalled()
  if (scenario !== 'cancel') await probe.close()
})
