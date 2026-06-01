import { afterEach, describe, expect, it, vi } from 'vitest'
import { adminApi } from './api'

describe('adminApi.cleanupLogs', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('sends cleanup cutoff dates as YYYY-MM-DD', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ deleted: 2 }), {
        headers: { 'Content-Type': 'application/json' },
        status: 200,
      })
    )

    await adminApi.cleanupLogs(new Date('2026-05-25T13:14:15.000Z'))

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/admin/logs/cleanup?before=2026-05-25',
      expect.objectContaining({
        credentials: 'include',
        method: 'DELETE',
      })
    )
  })
})
