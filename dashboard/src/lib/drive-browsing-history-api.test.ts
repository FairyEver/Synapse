import { afterEach, expect, it, vi } from 'vitest'
import { driveBrowserApi } from './api'

afterEach(() => vi.restoreAllMocks())

it('reports only visit identity through the browser cookie session and escapes target identifiers', async () => {
  const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }))
  const controller = new AbortController()
  await driveBrowserApi.recordShareVisit('share/a', 'item/b', { visitId: 'a7e7c83c-f11e-4cd4-9f45-efebca2baf51' }, controller.signal)
  expect(fetch).toHaveBeenCalledWith('/api/drive/browser/shares/share%2Fa/items/item%2Fb/visits', expect.objectContaining({
    method: 'POST', credentials: 'include', signal: controller.signal,
    body: '{"visitId":"a7e7c83c-f11e-4cd4-9f45-efebca2baf51"}',
    headers: { 'Content-Type': 'application/json' },
  }))
})
