import { afterEach, describe, expect, it, vi } from 'vitest'
import { adminApi, dashboardApi, driveAnnotationApi, driveApi, driveBrowserApi, driveFileVersionsApi, shouldNotifyAuthExpired, subscribeAdminAuthExpired, subscribeAuthExpired, userAuthApi } from './api'

describe('dashboardApi.apiKeys', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('uses current-user API key endpoints', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(() => Promise.resolve(
      new Response(JSON.stringify({ ok: true }), {
        headers: { 'Content-Type': 'application/json' },
        status: 200,
      })
    ))

    await dashboardApi.listApiKeys()
    await dashboardApi.listApiKeyCapabilities()
    await dashboardApi.createApiKey({ name: 'CLI', scopes: ['drive.public_link.download'] })
    await dashboardApi.updateApiKeyPermissions('key/id', [])
    await dashboardApi.renameApiKey('key/id', '生产环境')
    await dashboardApi.revokeApiKey('key/id')
    await dashboardApi.listApiKeyUsageLogs('key/id', { page: 2, pageSize: 10 })

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      '/api/console/api-keys',
      expect.objectContaining({ credentials: 'include' })
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      '/api/console/api-key-capabilities',
      expect.objectContaining({ credentials: 'include' })
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      '/api/console/api-keys',
      expect.objectContaining({
        body: JSON.stringify({ name: 'CLI', scopes: ['drive.public_link.download'] }),
        credentials: 'include',
        method: 'POST',
      })
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      4,
      '/api/console/api-keys/key%2Fid',
      expect.objectContaining({
        body: JSON.stringify({ scopes: [] }),
        credentials: 'include',
        method: 'PATCH',
      })
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      5,
      '/api/console/api-keys/key%2Fid',
      expect.objectContaining({
        body: JSON.stringify({ name: '生产环境' }),
        credentials: 'include',
        method: 'PATCH',
      })
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      6,
      '/api/console/api-keys/key%2Fid',
      expect.objectContaining({ credentials: 'include', method: 'DELETE' })
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      7,
      '/api/console/api-keys/key%2Fid/usage-logs?page=2&pageSize=10&sortBy=startedAt&sortOrder=desc',
      expect.objectContaining({ credentials: 'include' })
    )
  })
})

describe('driveAnnotationApi', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('bypasses the browser cache when refreshing annotation lists', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(() => Promise.resolve(
      new Response(JSON.stringify([]), {
        headers: { 'Content-Type': 'application/json' },
        status: 200,
      })
    ))

    await driveAnnotationApi.listOwner('item/id')
    await driveAnnotationApi.listShare('share/id', 'item/id')

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      '/api/drive/browser/owner/items/item%2Fid/annotations',
      expect.objectContaining({ cache: 'no-store', credentials: 'include' })
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      '/api/drive/browser/shares/share%2Fid/items/item%2Fid/annotations',
      expect.objectContaining({ cache: 'no-store', credentials: 'include' })
    )
  })
})

describe('adminApi.users', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('updates admin-only user notes through the admin endpoint', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ id: 'user/id', adminNote: '备注' }), {
        headers: { 'Content-Type': 'application/json' },
        status: 200,
      })
    )

    await adminApi.updateUserAdminNote('user/id', '备注')

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/admin/users/user%2Fid/admin-note',
      expect.objectContaining({
        body: JSON.stringify({ adminNote: '备注' }),
        credentials: 'include',
        method: 'PATCH',
      })
    )
  })

  it('searches users for administrator filters', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ data: [], total: 0, page: 1, pageSize: 20 }), {
        headers: { 'Content-Type': 'application/json' },
        status: 200,
      })
    )

    await adminApi.listUsers({ search: 'alice', pageSize: 20 })

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/admin/users?pageSize=20&search=alice',
      expect.objectContaining({ credentials: 'include' })
    )
  })

  it('creates password reset links through the admin endpoint', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({
        ok: true,
        resetUrl: 'https://app.example.com/console/reset-password?token=reset-token',
        expiresAt: '2026-09-02T02:30:00.000Z',
      }), {
        headers: { 'Content-Type': 'application/json' },
        status: 200,
      })
    )

    await adminApi.createUserPasswordResetLink('user/id')

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/admin/users/user%2Fid/password-reset-link',
      expect.objectContaining({ cache: 'no-store', credentials: 'include', method: 'POST' })
    )
  })
})

describe('userAuthApi.passwordReset', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('validates reset tokens without exposing a self-service request endpoint', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ valid: true, expiresAt: '2026-09-02T02:30:00.000Z' }), {
        headers: { 'Content-Type': 'application/json' },
        status: 200,
      })
    )

    await userAuthApi.validatePasswordResetToken('reset-token')

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/auth/password-reset/validate',
      expect.objectContaining({
        body: JSON.stringify({ token: 'reset-token' }),
        credentials: 'include',
        method: 'POST',
      })
    )
    expect(userAuthApi).not.toHaveProperty('requestPasswordReset')
  })
})

describe('adminApi.telemetry', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('requests aggregate statistics without caching', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ summary: { events: 0 }, trend: [], dimensions: {} }), {
        headers: { 'Content-Type': 'application/json' },
        status: 200,
      })
    )

    await adminApi.getTelemetryStats({ identity: 'anonymous', timezoneOffsetMinutes: 480 })

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/admin/telemetry/stats?identity=anonymous&timezoneOffsetMinutes=480',
      expect.objectContaining({ cache: 'no-store', credentials: 'include' })
    )
  })
})

describe('adminApi.drive', () => {
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

  it('uses admin public asset endpoints', async () => {
    const fetchMock = mockJsonResponse({ data: [], total: 0, page: 1, pageSize: 20 })

    await adminApi.listDrivePublicAssets({ page: 2, pageSize: 10, search: 'logo' })
    await adminApi.getDrivePublicAsset('asset/id')
    await adminApi.listDrivePublicAssetAccessLogs('asset/id', { page: 3 })
    await adminApi.listDrivePublicAssetRevisions('asset/id')
    await adminApi.getDriveStorageSummary()
    await adminApi.restoreDriveItem('item/id')

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      '/api/admin/drive/public-assets?page=2&pageSize=10&search=logo',
      expect.objectContaining({ credentials: 'include' })
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      '/api/admin/drive/public-assets/asset%2Fid',
      expect.objectContaining({ credentials: 'include' })
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      '/api/admin/drive/public-assets/asset%2Fid/access-logs?page=3',
      expect.objectContaining({ credentials: 'include' })
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      4,
      '/api/admin/drive/public-assets/asset%2Fid/revisions',
      expect.objectContaining({ credentials: 'include' })
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      5,
      '/api/admin/drive/storage-summary',
      expect.objectContaining({ credentials: 'include' })
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      6,
      '/api/admin/drive/items/item%2Fid/restore',
      expect.objectContaining({ credentials: 'include', method: 'POST' })
    )
  })

  it('includes admin public asset filters and sorting in list queries', async () => {
    const fetchMock = mockJsonResponse({ data: [], total: 0, page: 3, pageSize: 50 })

    await adminApi.listDrivePublicAssets({
      page: 3,
      pageSize: 50,
      sortBy: 'lastAccessedAt',
      sortOrder: 'asc',
      search: 'owner@example.com',
      userId: 'user-1',
      lifecycleStatus: 'hidden',
    })

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/admin/drive/public-assets?page=3&pageSize=50&sortBy=lastAccessedAt&sortOrder=asc&search=owner%40example.com&userId=user-1&lifecycleStatus=hidden',
      expect.objectContaining({ credentials: 'include' })
    )
  })

  it('downloads admin Drive files through authenticated preflight requests', async () => {
    const links: Array<{
      click: ReturnType<typeof vi.fn>
      download: string
      href: string
      rel: string
      remove: ReturnType<typeof vi.fn>
    }> = []
    const createElement = vi.fn(() => {
      const link = {
        click: vi.fn(),
        download: '',
        href: '',
        rel: '',
        remove: vi.fn(),
      }
      links.push(link)
      return link
    })
    const append = vi.fn()
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(null, { status: 200 })
    )
    vi.stubGlobal('document', {
      body: { append },
      createElement,
    })

    await adminApi.downloadDriveItem('item/id', 'report.pdf')
    await adminApi.downloadDrivePublicAssetRevision(
      'asset/id',
      'revision/id',
      'logo-old.png'
    )

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      '/api/admin/drive/items/item%2Fid/download',
      { credentials: 'include', method: 'HEAD' }
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      '/api/admin/drive/public-assets/asset%2Fid/revisions/revision%2Fid/download',
      { credentials: 'include', method: 'HEAD' }
    )
    expect(links).toMatchObject([
      {
        download: 'report.pdf',
        href: '/api/admin/drive/items/item%2Fid/download',
        rel: 'noopener',
      },
      {
        download: 'logo-old.png',
        href: '/api/admin/drive/public-assets/asset%2Fid/revisions/revision%2Fid/download',
        rel: 'noopener',
      },
    ])
    expect(links[0]?.click).toHaveBeenCalledOnce()
    expect(links[1]?.click).toHaveBeenCalledOnce()
    expect(append).toHaveBeenCalledTimes(2)
  })

  it.each([
    [
      'current file',
      () => adminApi.downloadDriveItem('item/id', 'report.pdf'),
    ],
    [
      'public asset revision',
      () => adminApi.downloadDrivePublicAssetRevision(
        'asset/id',
        'revision/id',
        'logo-old.png'
      ),
    ],
  ])('notifies admin auth expiration before downloading %s', async (_label, download) => {
    const authExpired = vi.fn()
    const unsubscribe = subscribeAdminAuthExpired(authExpired)
    const createElement = vi.fn()
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ message: '会话已过期。' }), {
        headers: { 'Content-Type': 'application/json' },
        status: 401,
      })
    )
    vi.stubGlobal('document', {
      body: { append: vi.fn() },
      createElement,
    })

    try {
      await expect(download()).rejects.toMatchObject({ status: 401 })
      expect(authExpired).toHaveBeenCalledOnce()
      expect(createElement).not.toHaveBeenCalled()
    } finally {
      unsubscribe()
    }
  })
})

describe('adminApi.skillRepositories', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('uses admin skill repository moderation endpoints', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(() =>
      Promise.resolve(
        new Response(JSON.stringify({ data: [], total: 0, page: 1, pageSize: 20 }), {
          headers: { 'Content-Type': 'application/json' },
          status: 200,
        })
      )
    )

    await adminApi.listSkillRepositories({
      page: 2,
      pageSize: 10,
      sortBy: 'updatedAt',
      sortOrder: 'desc',
      status: 'removed',
      query: 'demo skill',
    })
    await adminApi.setSkillRepositoryRemoved('repo/id')
    await adminApi.restoreSkillRepository('repo/id')

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      '/api/admin/skill-repositories?page=2&pageSize=10&sortBy=updatedAt&sortOrder=desc&status=removed&query=demo+skill',
      expect.objectContaining({ credentials: 'include' })
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      '/api/admin/skill-repositories/repo%2Fid/removed',
      expect.objectContaining({ credentials: 'include', method: 'POST' })
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      '/api/admin/skill-repositories/repo%2Fid/removed',
      expect.objectContaining({ credentials: 'include', method: 'DELETE' })
    )
  })
})

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

  it('uses a native download link after a successful preflight', async () => {
    const link = {
      click: vi.fn(),
      download: '',
      href: '',
      rel: '',
      remove: vi.fn(),
    }
    const append = vi.fn()
    const createElement = vi.fn(() => link)
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(null, { status: 200 })
    )
    const createObjectURL = vi.fn()
    const revokeObjectURL = vi.fn()
    vi.stubGlobal('document', {
      body: { append },
      createElement,
    })
    vi.stubGlobal('URL', {
      createObjectURL,
      revokeObjectURL,
    })

    await adminApi.downloadBackup('backup.tar.gz')

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/admin/backup/download/backup.tar.gz',
      { credentials: 'include', method: 'HEAD' }
    )
    expect(createElement).toHaveBeenCalledWith('a')
    expect(link.href).toBe('/api/admin/backup/download/backup.tar.gz')
    expect(link.download).toBe('backup.tar.gz')
    expect(link.rel).toBe('noopener')
    expect(append).toHaveBeenCalledWith(link)
    expect(link.click).toHaveBeenCalledOnce()
    expect(link.remove).toHaveBeenCalledOnce()
    expect(createObjectURL).not.toHaveBeenCalled()
    expect(revokeObjectURL).not.toHaveBeenCalled()
  })

  it('notifies auth expiration when the backup download request returns 401', async () => {
    const authExpired = vi.fn()
    const unsubscribe = subscribeAdminAuthExpired(authExpired)
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
        { credentials: 'include', method: 'HEAD' }
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

  it('uses console webhook management endpoints', async () => {
    const fetchMock = mockJsonResponse({ data: [], total: 0, page: 1, pageSize: 20 })

    await dashboardApi.listWebhooks({ page: 2, pageSize: 10 })
    await dashboardApi.getWebhook('hook/id')
    await dashboardApi.updateWebhook('hook/id', { name: 'Deploy', enabled: false })
    await dashboardApi.resetWebhookSecret('hook/id')
    await dashboardApi.listWebhookDeliveries('hook/id')

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      '/api/console/webhooks?page=2&pageSize=10',
      expect.objectContaining({
        credentials: 'include',
      })
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      '/api/console/webhooks/hook%2Fid',
      expect.objectContaining({
        credentials: 'include',
      })
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      '/api/console/webhooks/hook%2Fid',
      expect.objectContaining({
        body: JSON.stringify({ name: 'Deploy', enabled: false }),
        credentials: 'include',
        method: 'PATCH',
      })
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      4,
      '/api/console/webhooks/hook%2Fid/reset-secret',
      expect.objectContaining({
        credentials: 'include',
        method: 'POST',
      })
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      5,
      '/api/console/webhooks/hook%2Fid/deliveries',
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

  it('uses console device endpoints', async () => {
    const fetchMock = mockJsonResponse({ data: [], total: 0, page: 2, pageSize: 10 })

    await dashboardApi.listDevices({
      page: 2,
      pageSize: 10,
      sortBy: 'lastSeenAt',
      sortOrder: 'desc',
    })
    await dashboardApi.renameDevice('client/id', { displayName: 'Studio Mac' })

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      '/api/console/devices?page=2&pageSize=10&sortBy=lastSeenAt&sortOrder=desc',
      expect.objectContaining({ credentials: 'include' })
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      '/api/console/devices/client%2Fid',
      expect.objectContaining({
        body: JSON.stringify({ displayName: 'Studio Mac' }),
        credentials: 'include',
        method: 'PATCH',
      })
    )
  })
})

describe('driveBrowserApi', () => {
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

  it('uses owner and console browser endpoints', async () => {
    const fetchMock = mockJsonResponse({ ok: true })

    await driveBrowserApi.getOwnerItem('item/id')
    await driveBrowserApi.getConsoleRoot()
    await driveBrowserApi.getOwnerItem('folder/id', 'console')

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      '/api/drive/browser/owner/items/item%2Fid',
      expect.objectContaining({ credentials: 'include' })
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      '/api/drive/browser/owner/root',
      expect.objectContaining({ credentials: 'include' })
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      '/api/drive/browser/owner/items/folder%2Fid?surface=console',
      expect.objectContaining({ credentials: 'include' })
    )
  })

  it('passes browser child pagination query parameters', async () => {
    const fetchMock = mockJsonResponse({ ok: true })

    await driveBrowserApi.getOwnerItem('folder/id', 'console', {
      childrenOffset: 100,
      childrenLimit: 50,
    })
    await driveBrowserApi.getShareRoot('shr/id', { childrenOffset: 50 })

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      '/api/drive/browser/owner/items/folder%2Fid?surface=console&childrenOffset=100&childrenLimit=50',
      expect.objectContaining({ credentials: 'include' })
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      '/api/drive/browser/shares/shr%2Fid?childrenOffset=50',
      expect.objectContaining({ credentials: 'include' })
    )
  })

  it('uses share browser endpoints and unlocks with POST JSON', async () => {
    const fetchMock = mockJsonResponse({ ok: true })

    await driveBrowserApi.getShareRoot('shr/id')
    await driveBrowserApi.getShareItem('shr/id', 'child/id')
    await driveBrowserApi.unlockShare('shr/id', 'letmein')
    await driveBrowserApi.unlockShare('shr/id', 'letmein', 'child/id')

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      '/api/drive/browser/shares/shr%2Fid',
      expect.objectContaining({ credentials: 'include' })
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      '/api/drive/browser/shares/shr%2Fid/items/child%2Fid',
      expect.objectContaining({ credentials: 'include' })
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      '/api/drive/browser/shares/shr%2Fid/access',
      expect.objectContaining({
        body: JSON.stringify({ password: 'letmein' }),
        credentials: 'include',
        method: 'POST',
      })
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      4,
      '/api/drive/browser/shares/shr%2Fid/items/child%2Fid/access',
      expect.objectContaining({
        body: JSON.stringify({ password: 'letmein' }),
        credentials: 'include',
        method: 'POST',
      })
    )
  })

  it('uses markdown image source endpoints', async () => {
    const fetchMock = mockJsonResponse({ ok: true })

    await driveBrowserApi.scanOwnerImageSources('item/id')
    await driveBrowserApi.importOwnerImageSources('item/id', {
      baseVersionId: 'version-1',
      sources: [{ src: 'https://example.test/a.png' }],
    })
    await driveBrowserApi.scanShareImageSources('shr/id')
    await driveBrowserApi.scanShareImageSources('shr/id', 'child/id')
    await driveBrowserApi.importShareImageSources('shr/id', 'child/id', {
      baseVersionId: 'version-2',
      sources: [{ src: 'https://example.test/b.png' }],
    })

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      '/api/drive/browser/owner/items/item%2Fid/image-sources',
      expect.objectContaining({ credentials: 'include' })
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      '/api/drive/browser/owner/items/item%2Fid/image-sources/import',
      expect.objectContaining({
        body: JSON.stringify({
          baseVersionId: 'version-1',
          sources: [{ src: 'https://example.test/a.png' }],
        }),
        credentials: 'include',
        method: 'POST',
      })
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      '/api/drive/browser/shares/shr%2Fid/image-sources',
      expect.objectContaining({ credentials: 'include' })
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      4,
      '/api/drive/browser/shares/shr%2Fid/items/child%2Fid/image-sources',
      expect.objectContaining({ credentials: 'include' })
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      5,
      '/api/drive/browser/shares/shr%2Fid/items/child%2Fid/image-sources/import',
      expect.objectContaining({
        body: JSON.stringify({
          baseVersionId: 'version-2',
          sources: [{ src: 'https://example.test/b.png' }],
        }),
        credentials: 'include',
        method: 'POST',
      })
    )
  })

  it('does not pass share password query when loading public browser snapshots', async () => {
    const fetchMock = mockJsonResponse({ ok: true })

    await driveBrowserApi.getShareRoot('shr/id', 'CtekZGNr')
    await driveBrowserApi.getShareItem('shr/id', 'child/id', 'CtekZGNr')

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      '/api/drive/browser/shares/shr%2Fid',
      expect.objectContaining({ credentials: 'include' })
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      '/api/drive/browser/shares/shr%2Fid/items/child%2Fid',
      expect.objectContaining({ credentials: 'include' })
    )
  })

  it('notifies auth expiration for protected browser write requests only', async () => {
    const authExpired = vi.fn()
    const unsubscribe = subscribeAuthExpired(authExpired)
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ message: '会话已过期。' }), {
        headers: { 'Content-Type': 'application/json' },
        status: 401,
      })
    )

    try {
      await expect(driveBrowserApi.getConsoleRoot()).rejects.toMatchObject({ status: 401 })
      expect(authExpired).toHaveBeenCalledOnce()

      authExpired.mockClear()
      await expect(driveBrowserApi.getShareRoot('shr/id')).rejects.toMatchObject({ status: 401 })
      expect(authExpired).not.toHaveBeenCalled()

      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify({
          code: 'DRIVE_SHARE_UNLOCK_REQUIRED',
          message: '需要先解锁分享。',
        }), {
          headers: { 'Content-Type': 'application/json' },
          status: 401,
        })
      )
      authExpired.mockClear()
      await expect(driveBrowserApi.updateShareText('shr/id', null, {
        baseVersionId: 'version-1',
        contentType: 'text',
        text: 'updated',
      })).rejects.toMatchObject({
        code: 'DRIVE_SHARE_UNLOCK_REQUIRED',
        message: '需要先解锁分享。',
        status: 401,
      })
      expect(authExpired).not.toHaveBeenCalled()

      authExpired.mockClear()
      await expect(driveBrowserApi.updateShareText('shr/id', null, {
        baseVersionId: 'version-1',
        contentType: 'text',
        text: 'updated',
      })).rejects.toMatchObject({ status: 401 })
      expect(authExpired).toHaveBeenCalledOnce()

      authExpired.mockClear()
      await expect(driveBrowserApi.updateShareText('shr/id', 'child/id', {
        baseVersionId: 'version-1',
        contentType: 'text',
        text: 'updated',
      })).rejects.toMatchObject({ status: 401 })
      expect(authExpired).toHaveBeenCalledOnce()

      authExpired.mockClear()
      await expect(driveBrowserApi.scanShareImageSources('shr/id')).rejects.toMatchObject({ status: 401 })
      expect(authExpired).toHaveBeenCalledOnce()

      authExpired.mockClear()
      await expect(driveBrowserApi.importShareImageSources('shr/id', 'child/id', {
        baseVersionId: 'version-1',
        sources: [{ src: 'https://example.test/image.png' }],
      })).rejects.toMatchObject({ status: 401 })
      expect(authExpired).toHaveBeenCalledOnce()

      expect(shouldNotifyAuthExpired('/api/drive/browser/shares/shr%2Fid', 401)).toBe(false)
      expect(shouldNotifyAuthExpired('/api/drive/browser/shares/shr%2Fid/access', 401)).toBe(false)
      expect(shouldNotifyAuthExpired('/api/drive/browser/shares/shr%2Fid/content', 401)).toBe(true)
      expect(shouldNotifyAuthExpired('/api/drive/browser/shares/shr%2Fid/content', 401, 'DRIVE_SHARE_UNLOCK_REQUIRED')).toBe(false)
      expect(shouldNotifyAuthExpired('/api/drive/browser/shares/shr%2Fid/items/child%2Fid/content', 401)).toBe(true)
      expect(shouldNotifyAuthExpired('/api/drive/browser/shares/shr%2Fid/image-sources', 401)).toBe(true)
      expect(shouldNotifyAuthExpired('/api/drive/browser/shares/shr%2Fid/image-sources/import', 401)).toBe(true)
      expect(shouldNotifyAuthExpired('/api/drive/browser/shares/shr%2Fid/items/child%2Fid/image-sources', 401)).toBe(true)
      expect(shouldNotifyAuthExpired('/api/drive/browser/shares/shr%2Fid/items/child%2Fid/image-sources/import', 401)).toBe(true)
    } finally {
      unsubscribe()
    }
  })
})

describe('driveApi', () => {
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

  it('uses user Drive management endpoints', async () => {
    const fetchMock = mockJsonResponse({ ok: true })

    await driveApi.getUsage()
    await driveApi.prepareUpload({ parentId: 'folder/id', name: 'a.md', size: '12', mimeType: 'text/markdown' })
    await driveApi.completeUpload('session/id')
    await driveApi.cancelUpload('session/id')
    await driveApi.createFolder({ parentId: 'folder/id', name: 'Docs' })
    await driveApi.renameItem('item/id', 'Next.md')
    await driveApi.moveItem('item/id', null)
    await driveApi.listTree({ parentId: 'folder/id', offset: 2, limit: 30 })
    await driveApi.deleteItem('item/id')
    await driveApi.listTrash({ offset: 10, limit: 20, search: 'old' })
    await driveApi.restoreItem('item/id')
    await driveApi.deleteTrashItem('item/id')

    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/drive/usage', expect.objectContaining({ credentials: 'include' }))
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/drive/uploads/prepare', expect.objectContaining({
      body: JSON.stringify({ parentId: 'folder/id', name: 'a.md', size: '12', mimeType: 'text/markdown' }),
      credentials: 'include',
      method: 'POST',
    }))
    expect(fetchMock).toHaveBeenNthCalledWith(3, '/api/drive/uploads/session%2Fid/complete', expect.objectContaining({ credentials: 'include', method: 'POST' }))
    expect(fetchMock).toHaveBeenNthCalledWith(4, '/api/drive/uploads/session%2Fid/cancel', expect.objectContaining({ credentials: 'include', method: 'POST' }))
    expect(fetchMock).toHaveBeenNthCalledWith(5, '/api/drive/folders', expect.objectContaining({
      body: JSON.stringify({ parentId: 'folder/id', name: 'Docs' }),
      credentials: 'include',
      method: 'POST',
    }))
    expect(fetchMock).toHaveBeenNthCalledWith(6, '/api/drive/items/item%2Fid', expect.objectContaining({
      body: JSON.stringify({ name: 'Next.md' }),
      credentials: 'include',
      method: 'PATCH',
    }))
    expect(fetchMock).toHaveBeenNthCalledWith(7, '/api/drive/items/item%2Fid', expect.objectContaining({
      body: JSON.stringify({ parentId: null }),
      credentials: 'include',
      method: 'PATCH',
    }))
    expect(fetchMock).toHaveBeenNthCalledWith(8, '/api/drive/items/tree?parentId=folder%2Fid&offset=2&limit=30', expect.objectContaining({ credentials: 'include' }))
    expect(fetchMock).toHaveBeenNthCalledWith(9, '/api/drive/items/item%2Fid', expect.objectContaining({ credentials: 'include', method: 'DELETE' }))
    expect(fetchMock).toHaveBeenNthCalledWith(10, '/api/drive/trash?offset=10&limit=20&search=old', expect.objectContaining({ credentials: 'include' }))
    expect(fetchMock).toHaveBeenNthCalledWith(11, '/api/drive/items/item%2Fid/restore', expect.objectContaining({ credentials: 'include', method: 'POST' }))
    expect(fetchMock).toHaveBeenNthCalledWith(12, '/api/drive/trash/item%2Fid', expect.objectContaining({ credentials: 'include', method: 'DELETE' }))
  })

  it('uses share, site, and public asset endpoints', async () => {
    const fetchMock = mockJsonResponse({ ok: true })

    await driveApi.createShare('item/id', { passwordEnabled: true, expiresIn: '3d', accessMode: 'link_edit', editorEmails: [] })
    await driveApi.disableShare('share/id')
    await driveApi.getShare('share/id')
    await driveApi.listShares({ offset: 20, limit: 10 })
    await driveApi.preflightSite('folder/id')
    await driveApi.createSite({ sourceFolderItemId: 'folder/id', name: 'Docs', entryPath: 'index.html', accessMode: 'public', expiresIn: 'forever' })
    await driveApi.listSites({ offset: 5, limit: 10, search: 'docs', status: 'active' })
    await driveApi.updateSiteAccess('site/id', { accessMode: 'password', password: 'pw', expiresIn: '7d' })
    await driveApi.disableSite('site/id')
    await driveApi.enableSite('site/id')
    await driveApi.republishSite('site/id', { entryPath: 'index.html' })
    await driveApi.deleteSite('site/id')
    await driveApi.listPublicAssets({ offset: 0, limit: 20 })
    await driveApi.preparePublicAssetUpload({ name: 'logo.png', size: '10', mimeType: 'image/png' })
    await driveApi.completePublicAssetUpload('session/id')
    await driveApi.cancelPublicAssetUpload('session/id')
    await driveApi.preparePublicAssetReplace('asset/id', { name: 'logo.png', size: '10', mimeType: 'image/png' })
    await driveApi.completePublicAssetReplace('asset/id', 'session/id')
    await driveApi.cancelPublicAssetReplace('asset/id', 'session/id')
    await driveApi.renamePublicAsset('asset/id', 'logo.png')
    await driveApi.trashPublicAsset('asset/id')
    await driveApi.restorePublicAsset('asset/id')

    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/drive/items/item%2Fid/share', expect.objectContaining({ credentials: 'include', method: 'POST' }))
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/drive/shares/share%2Fid', expect.objectContaining({ credentials: 'include', method: 'DELETE' }))
    expect(fetchMock).toHaveBeenNthCalledWith(3, '/api/drive/shares/share%2Fid', expect.objectContaining({ credentials: 'include' }))
    expect(fetchMock).toHaveBeenNthCalledWith(4, '/api/drive/shares?offset=20&limit=10', expect.objectContaining({ credentials: 'include' }))
    expect(fetchMock).toHaveBeenNthCalledWith(5, '/api/drive/sites/preflight?sourceFolderItemId=folder%2Fid', expect.objectContaining({ credentials: 'include' }))
    expect(fetchMock).toHaveBeenNthCalledWith(6, '/api/drive/sites', expect.objectContaining({ credentials: 'include', method: 'POST' }))
    expect(fetchMock).toHaveBeenNthCalledWith(7, '/api/drive/sites?offset=5&limit=10&search=docs&status=active', expect.objectContaining({ credentials: 'include' }))
    expect(fetchMock).toHaveBeenNthCalledWith(8, '/api/drive/sites/site%2Fid/access', expect.objectContaining({ credentials: 'include', method: 'PATCH' }))
    expect(fetchMock).toHaveBeenNthCalledWith(9, '/api/drive/sites/site%2Fid/disable', expect.objectContaining({ credentials: 'include', method: 'POST' }))
    expect(fetchMock).toHaveBeenNthCalledWith(10, '/api/drive/sites/site%2Fid/enable', expect.objectContaining({ credentials: 'include', method: 'POST' }))
    expect(fetchMock).toHaveBeenNthCalledWith(11, '/api/drive/sites/site%2Fid/republish', expect.objectContaining({ credentials: 'include', method: 'POST' }))
    expect(fetchMock).toHaveBeenNthCalledWith(12, '/api/drive/sites/site%2Fid', expect.objectContaining({ credentials: 'include', method: 'DELETE' }))
    expect(fetchMock).toHaveBeenNthCalledWith(13, '/api/drive/public-assets?offset=0&limit=20', expect.objectContaining({ credentials: 'include' }))
    expect(fetchMock).toHaveBeenNthCalledWith(14, '/api/drive/public-assets/uploads/prepare', expect.objectContaining({ credentials: 'include', method: 'POST' }))
    expect(fetchMock).toHaveBeenNthCalledWith(15, '/api/drive/public-assets/uploads/session%2Fid/complete', expect.objectContaining({ credentials: 'include', method: 'POST' }))
    expect(fetchMock).toHaveBeenNthCalledWith(16, '/api/drive/public-assets/uploads/session%2Fid/cancel', expect.objectContaining({ credentials: 'include', method: 'POST' }))
    expect(fetchMock).toHaveBeenNthCalledWith(17, '/api/drive/public-assets/asset%2Fid/replace/prepare', expect.objectContaining({ credentials: 'include', method: 'POST' }))
    expect(fetchMock).toHaveBeenNthCalledWith(18, '/api/drive/public-assets/asset%2Fid/replace/session%2Fid/complete', expect.objectContaining({ credentials: 'include', method: 'POST' }))
    expect(fetchMock).toHaveBeenNthCalledWith(19, '/api/drive/public-assets/asset%2Fid/replace/session%2Fid/cancel', expect.objectContaining({ credentials: 'include', method: 'POST' }))
    expect(fetchMock).toHaveBeenNthCalledWith(20, '/api/drive/public-assets/asset%2Fid', expect.objectContaining({ credentials: 'include', method: 'PATCH' }))
    expect(fetchMock).toHaveBeenNthCalledWith(21, '/api/drive/public-assets/asset%2Fid', expect.objectContaining({ credentials: 'include', method: 'DELETE' }))
    expect(fetchMock).toHaveBeenNthCalledWith(22, '/api/drive/public-assets/asset%2Fid/restore', expect.objectContaining({ credentials: 'include', method: 'POST' }))
  })

  it('cancels prepared public asset uploads when browser transfer fails', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input)
      if (url === '/api/drive/public-assets/uploads/prepare') {
        return new Response(JSON.stringify({
          sessionId: 'session/id',
          item: { id: 'item-1', name: 'logo.png' },
          upload: {
            method: 'PUT',
            url: 'https://cos.example/upload?signature=secret',
            expiresAt: '2026-06-07T00:00:00.000Z',
            headers: { 'x-upload': '1' },
          },
        }), {
          headers: { 'Content-Type': 'application/json' },
          status: 200,
        })
      }
      if (url === 'https://cos.example/upload?signature=secret') {
        return new Response(JSON.stringify({ message: '上传失败。' }), {
          headers: { 'Content-Type': 'application/json' },
          status: 500,
        })
      }
      if (url === '/api/drive/public-assets/uploads/session%2Fid/cancel') {
        return new Response(JSON.stringify({ ok: true }), {
          headers: { 'Content-Type': 'application/json' },
          status: 200,
        })
      }
      throw new Error(`Unexpected fetch ${url}`)
    })

    const file = new File(['image'], 'logo.png', { type: 'image/png' })

    await expect(driveBrowserApi.uploadPublicAssetFile(file, {
      name: 'logo.png',
      mimeType: 'image/png',
    })).rejects.toMatchObject({ status: 500 })

    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/drive/public-assets/uploads/prepare', expect.objectContaining({
      credentials: 'include',
      method: 'POST',
    }))
    expect(fetchMock).toHaveBeenNthCalledWith(2, 'https://cos.example/upload?signature=secret', expect.objectContaining({
      method: 'PUT',
      headers: { 'x-upload': '1' },
      body: file,
    }))
    expect(fetchMock).toHaveBeenNthCalledWith(3, '/api/drive/public-assets/uploads/session%2Fid/cancel', expect.objectContaining({
      credentials: 'include',
      method: 'POST',
    }))
  })

  it('notifies auth expiration for protected user Drive requests', async () => {
    const authExpired = vi.fn()
    const unsubscribe = subscribeAuthExpired(authExpired)
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ message: '会话已过期。' }), {
        headers: { 'Content-Type': 'application/json' },
        status: 401,
      })
    )

    try {
      await expect(driveApi.getUsage()).rejects.toMatchObject({ status: 401 })
      expect(authExpired).toHaveBeenCalledOnce()
    } finally {
      unsubscribe()
    }
  })
})

describe('driveFileVersionsApi', () => {
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

  it('uses owner file version endpoints', async () => {
    const fetchMock = mockJsonResponse({ ok: true })

    await driveFileVersionsApi.list('item/id', { offset: 10, limit: 20 })
    await driveFileVersionsApi.restore('item/id', 'version/id')
    await driveFileVersionsApi.updatePin('item/id', 'version/id', true)
    await driveFileVersionsApi.delete('item/id', 'version/id')

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      '/api/drive/items/item%2Fid/versions?offset=10&limit=20',
      expect.objectContaining({ credentials: 'include' })
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      '/api/drive/items/item%2Fid/versions/version%2Fid/restore',
      expect.objectContaining({
        credentials: 'include',
        method: 'POST',
      })
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      '/api/drive/items/item%2Fid/versions/version%2Fid',
      expect.objectContaining({
        body: JSON.stringify({ isPinned: true }),
        credentials: 'include',
        method: 'PATCH',
      })
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      4,
      '/api/drive/items/item%2Fid/versions/version%2Fid',
      expect.objectContaining({
        credentials: 'include',
        method: 'DELETE',
      })
    )
    expect(driveFileVersionsApi.downloadUrl('item/id', 'version/id')).toBe(
      '/api/drive/items/item%2Fid/versions/version%2Fid/download'
    )
  })

  it('notifies auth expiration for protected Drive user requests', async () => {
    const authExpired = vi.fn()
    const unsubscribe = subscribeAuthExpired(authExpired)
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ message: '会话已过期。' }), {
        headers: { 'Content-Type': 'application/json' },
        status: 401,
      })
    )

    try {
      await expect(driveFileVersionsApi.list('item/id')).rejects.toMatchObject({ status: 401 })
      expect(authExpired).toHaveBeenCalledOnce()
      expect(shouldNotifyAuthExpired('/api/drive/items/item%2Fid/versions', 401)).toBe(true)
      expect(shouldNotifyAuthExpired('/api/drive/browser/shares/shr%2Fid', 401)).toBe(false)
      expect(shouldNotifyAuthExpired('/api/drive/local-upload/session-1', 401)).toBe(false)
      expect(shouldNotifyAuthExpired('/api/drive/local-download/session-1', 401)).toBe(false)
    } finally {
      unsubscribe()
    }
  })
})

describe('dashboardApi auth expiration compatibility', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('keeps legacy dashboard session checks out of auth-expired notifications', async () => {
    const authExpired = vi.fn()
    const unsubscribe = subscribeAuthExpired(authExpired)
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ message: '会话已过期。' }), {
        headers: { 'Content-Type': 'application/json' },
        status: 401,
      })
    )

    try {
      await expect(dashboardApi.getSession()).rejects.toMatchObject({ status: 401 })
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/console/session',
        expect.objectContaining({ credentials: 'include' })
      )
      expect(authExpired).not.toHaveBeenCalled()
    } finally {
      unsubscribe()
    }
  })

  it('recognizes legacy dashboard session as an auth-expired compatibility path', () => {
    expect(shouldNotifyAuthExpired('/api/dashboard/session', 401)).toBe(false)
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

describe('dashboardApi.skillRepository', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('builds Skill Repository file download URLs without issuing requests', () => {
    expect(dashboardApi.getSkillRepositoryFileDownloadUrl('repo/id', 'assets/logo file.png')).toBe(
      '/api/skill-repositories/repo%2Fid/files/download?path=assets%2Flogo+file.png'
    )
    expect(dashboardApi.getSkillRepositoryFileDownloadUrlByPath('alice', 'demo/skill', 'README.md')).toBe(
      '/api/skill-repositories/by-path/alice/demo%2Fskill/files/download?path=README.md'
    )
  })
})

describe('adminApi.drive', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('serializes admin drive filters', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({ data: [], total: 0, page: 2, pageSize: 10 }),
        {
          headers: { 'Content-Type': 'application/json' },
          status: 200,
        }
      )
    )

    await adminApi.listDriveItems({
      page: 2,
      pageSize: 10,
      sortBy: 'createdAt',
      sortOrder: 'desc',
      userId: 'user-1',
      type: 'file',
      storageStatus: 'active',
      shared: 'true',
      search: 'report',
    })

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/admin/drive/items?page=2&pageSize=10&sortBy=createdAt&sortOrder=desc&userId=user-1&type=file&storageStatus=active&shared=true&search=report',
      expect.objectContaining({ credentials: 'include' })
    )
  })
})
