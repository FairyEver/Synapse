import { afterEach, describe, expect, it, vi } from 'vitest'
import { adminApi, subscribeAuthExpired } from './api'

describe('adminApi.cleanupLogs', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
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

describe('adminApi.downloadBackup', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('notifies auth expiration when the backup download request returns 401', async () => {
    const authExpired = vi.fn()
    const unsubscribe = subscribeAuthExpired(authExpired)
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ message: '会话已过期。' }), {
        headers: { 'Content-Type': 'application/json' },
        status: 401,
      })
    )
    vi.stubGlobal('document', {
      body: { append: vi.fn() },
      createElement: vi.fn(() => ({
        click: vi.fn(),
        remove: vi.fn(),
        rel: '',
        download: '',
        href: '',
      })),
    })

    try {
      await expect(adminApi.downloadBackup('backup.tar.gz')).rejects.toMatchObject({
        status: 401,
      })

      expect(fetchMock).toHaveBeenCalledWith(
        '/api/admin/backup/download/backup.tar.gz',
        { credentials: 'include' }
      )
      expect(authExpired).toHaveBeenCalledOnce()
    } finally {
      unsubscribe()
    }
  })
})
