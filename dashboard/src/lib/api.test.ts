import { afterEach, describe, expect, it, vi } from 'vitest'
import { adminApi, dashboardApi, subscribeAuthExpired } from './api'

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

describe('dashboardApi.webhooks', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  function mockJsonResponse(payload: unknown) {
    return vi.spyOn(globalThis, 'fetch').mockImplementation(() =>
      Promise.resolve(
        new Response(JSON.stringify(payload), {
          headers: { 'Content-Type': 'application/json' },
          status: 200,
        })
      )
    )
  }

  it('uses dashboard webhook management endpoints', async () => {
    const fetchMock = mockJsonResponse({ ok: true })

    await dashboardApi.updateWebhook('hook/id', { name: 'Deploy', enabled: false })
    await dashboardApi.resetWebhookSecret('hook/id')
    await dashboardApi.listWebhookDeliveries('hook/id')

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      '/api/dashboard/webhooks/hook%2Fid',
      expect.objectContaining({
        body: JSON.stringify({ name: 'Deploy', enabled: false }),
        credentials: 'include',
        method: 'PATCH',
      })
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      '/api/dashboard/webhooks/hook%2Fid/reset-secret',
      expect.objectContaining({
        credentials: 'include',
        method: 'POST',
      })
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      '/api/dashboard/webhooks/hook%2Fid/deliveries',
      expect.objectContaining({
        credentials: 'include',
      })
    )
  })
})

describe('dashboardApi.devices', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  function mockJsonResponse(payload: unknown) {
    return vi.spyOn(globalThis, 'fetch').mockImplementation(() =>
      Promise.resolve(
        new Response(JSON.stringify(payload), {
          headers: { 'Content-Type': 'application/json' },
          status: 200,
        })
      )
    )
  }

  it('uses dashboard device endpoints', async () => {
    const fetchMock = mockJsonResponse({ ok: true })

    await dashboardApi.listDevices()
    await dashboardApi.renameDevice('client/id', { displayName: 'Studio Mac' })

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      '/api/dashboard/devices',
      expect.objectContaining({ credentials: 'include' })
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      '/api/dashboard/devices/client%2Fid',
      expect.objectContaining({
        body: JSON.stringify({ displayName: 'Studio Mac' }),
        credentials: 'include',
        method: 'PATCH',
      })
    )
  })
})

describe('adminApi.devices', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('uses admin device pagination endpoint', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ data: [], total: 0, page: 2, pageSize: 10 }), {
        headers: { 'Content-Type': 'application/json' },
        status: 200,
      })
    )

    await adminApi.listDevices({
      page: 2,
      pageSize: 10,
      sortBy: 'lastSeenAt',
      sortOrder: 'desc',
    })

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/admin/devices?page=2&pageSize=10&sortBy=lastSeenAt&sortOrder=desc',
      expect.objectContaining({ credentials: 'include' })
    )
  })
})
