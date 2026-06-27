import { afterEach, describe, expect, it, vi } from 'vitest'
import { adminApi, dashboardApi, driveBrowserApi, driveFileVersionsApi, shouldNotifyAuthExpired, subscribeAuthExpired } from './api'

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

  it('encodes admin public asset revision download URLs', () => {
    expect(adminApi.downloadDrivePublicAssetRevisionUrl('asset/id', 'revision/id')).toBe(
      '/api/admin/drive/public-assets/asset%2Fid/revisions/revision%2Fid/download'
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
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
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

      expect(shouldNotifyAuthExpired('/api/drive/browser/shares/shr%2Fid', 401)).toBe(false)
      expect(shouldNotifyAuthExpired('/api/drive/browser/shares/shr%2Fid/access', 401)).toBe(false)
      expect(shouldNotifyAuthExpired('/api/drive/browser/shares/shr%2Fid/content', 401)).toBe(true)
      expect(shouldNotifyAuthExpired('/api/drive/browser/shares/shr%2Fid/items/child%2Fid/content', 401)).toBe(true)
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

describe('dashboardApi.contentStore', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('serializes content store list queries and item actions', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({ data: [], total: 0, page: 1, pageSize: 20 }),
          {
            headers: { 'Content-Type': 'application/json' },
            status: 200,
          }
        )
      )
    )

    await dashboardApi.listContentStoreItems({
      page: 2,
      pageSize: 20,
      sortBy: 'installCount',
      sortOrder: 'desc',
      type: 'skill',
      query: 'sync',
    })
    await dashboardApi.listMyContentStoreItems({ type: 'prompt', query: 'memo' })
    await dashboardApi.copyContentStoreItem('item/id')
    await dashboardApi.setContentStoreVisibility('item/id', 'public')
    await dashboardApi.createContentStoreInstallSession('item/id')

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      '/api/content-store/items?page=2&pageSize=20&sortBy=installCount&sortOrder=desc&type=skill&query=sync',
      expect.objectContaining({ credentials: 'include' })
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      '/api/content-store/mine?type=prompt&query=memo',
      expect.objectContaining({ credentials: 'include' })
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      '/api/content-store/items/item%2Fid/copy',
      expect.objectContaining({ credentials: 'include', method: 'POST' })
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      4,
      '/api/content-store/items/item%2Fid/visibility',
      expect.objectContaining({
        body: JSON.stringify({ visibility: 'public' }),
        credentials: 'include',
        method: 'POST',
      })
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      5,
      '/api/content-store/items/item%2Fid/install-sessions',
      expect.objectContaining({
        body: JSON.stringify({}),
        credentials: 'include',
        method: 'POST',
      })
    )
  })

  it('serializes content store draft authoring requests', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(() =>
      Promise.resolve(
        new Response(JSON.stringify({ id: 'draft-1', revision: 2 }), {
          headers: { 'Content-Type': 'application/json' },
          status: 200,
        })
      )
    )

    await dashboardApi.createContentStoreDraft({
      type: 'skill',
      title: 'Skill',
      description: null,
      files: [{ path: 'SKILL.md', contentBase64: 'IyBTa2lsbA==', mimeType: 'text/markdown' }],
    })
    await dashboardApi.getContentStoreDraft('item/id')
    await dashboardApi.saveContentStoreDraft('item/id', {
      type: 'rule',
      baseRevision: 2,
      title: 'Rule',
      description: 'Deploy',
      body: 'body',
    })
    await dashboardApi.publishContentStoreDraft('item/id', { baseRevision: 3 })

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      '/api/content-store/drafts',
      expect.objectContaining({
        body: JSON.stringify({
          type: 'skill',
          title: 'Skill',
          description: null,
          files: [{ path: 'SKILL.md', contentBase64: 'IyBTa2lsbA==', mimeType: 'text/markdown' }],
        }),
        credentials: 'include',
        method: 'POST',
      })
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      '/api/content-store/items/item%2Fid/draft',
      expect.objectContaining({ credentials: 'include' })
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      '/api/content-store/items/item%2Fid/draft',
      expect.objectContaining({
        body: JSON.stringify({
          type: 'rule',
          baseRevision: 2,
          title: 'Rule',
          description: 'Deploy',
          body: 'body',
        }),
        credentials: 'include',
        method: 'PUT',
      })
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      4,
      '/api/content-store/items/item%2Fid/publish',
      expect.objectContaining({
        body: JSON.stringify({ baseRevision: 3 }),
        credentials: 'include',
        method: 'POST',
      })
    )
  })

  it('notifies auth expiration for content store user requests', async () => {
    const authExpired = vi.fn()
    const unsubscribe = subscribeAuthExpired(authExpired)
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ message: '会话已过期。' }), {
        headers: { 'Content-Type': 'application/json' },
        status: 401,
      })
    )

    try {
      await expect(dashboardApi.listContentStoreItems()).rejects.toMatchObject({
        status: 401,
      })
      expect(authExpired).toHaveBeenCalledOnce()
    } finally {
      unsubscribe()
    }
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

describe('adminApi.teams', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('serializes team search pagination options', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ data: [], total: 0, page: 1, pageSize: 20 }), {
        headers: { 'Content-Type': 'application/json' },
        status: 200,
      })
    )

    await adminApi.listTeams({
      page: 1,
      pageSize: 20,
      sortBy: 'name',
      sortOrder: 'asc',
      search: '研发',
    })

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/admin/teams?page=1&pageSize=20&sortBy=name&sortOrder=asc&search=%E7%A0%94%E5%8F%91',
      expect.objectContaining({ credentials: 'include' })
    )
  })
})

describe('adminApi.contentStore', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('serializes admin content store filters and moderation actions', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({ data: [], total: 0, page: 1, pageSize: 20 }),
          {
            headers: { 'Content-Type': 'application/json' },
            status: 200,
          }
        )
      )
    )

    await adminApi.listContentStoreItems({
      page: 3,
      pageSize: 10,
      sortBy: 'updatedAt',
      sortOrder: 'asc',
      type: 'rule',
      visibility: 'public',
      moderationStatus: 'normal',
      query: 'deploy',
    })
    await adminApi.getContentStoreDetail('item/id')
    await adminApi.setContentStoreFeatured('item/id', true)
    await adminApi.setContentStoreRemoved('item/id', false)

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      '/api/admin/content-store/items?page=3&pageSize=10&sortBy=updatedAt&sortOrder=asc&type=rule&query=deploy&visibility=public&moderationStatus=normal',
      expect.objectContaining({ credentials: 'include' })
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      '/api/admin/content-store/items/item%2Fid',
      expect.objectContaining({ credentials: 'include' })
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      '/api/admin/content-store/items/item%2Fid/featured',
      expect.objectContaining({
        body: JSON.stringify({ value: true }),
        credentials: 'include',
        method: 'POST',
      })
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      4,
      '/api/admin/content-store/items/item%2Fid/removed',
      expect.objectContaining({
        body: JSON.stringify({ value: false }),
        credentials: 'include',
        method: 'POST',
      })
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
