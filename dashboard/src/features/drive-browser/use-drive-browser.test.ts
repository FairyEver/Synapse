import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DriveBrowserSnapshotDto } from '@synapse/shared'
import { driveBrowserApi } from '@/lib/api'

import { loadDriveBrowser, toDriveBrowserQueryKey } from './use-drive-browser'

vi.mock('@/lib/api', () => ({
  driveBrowserApi: {
    getConsoleRoot: vi.fn(),
    getOwnerItem: vi.fn(),
    getShareItem: vi.fn(),
    getShareRoot: vi.fn(),
    unlockShare: vi.fn(),
  },
}))

afterEach(() => {
  vi.clearAllMocks()
})

describe('toDriveBrowserQueryKey', () => {
  it('separates share browser cache entries by initial password value without storing plaintext passwords', () => {
    const first = toDriveBrowserQueryKey({
      context: 'share',
      shareId: 'share-1',
      itemId: 'item-1',
      initialPassword: 'old-password',
    })
    const second = toDriveBrowserQueryKey({
      context: 'share',
      shareId: 'share-1',
      itemId: 'item-1',
      initialPassword: 'new-password',
    })

    expect(first).not.toEqual(second)
    expect(JSON.stringify(first)).not.toContain('old-password')
    expect(JSON.stringify(second)).not.toContain('new-password')
  })

  it('uses the unlock endpoint for initial share passwords', async () => {
    const snapshot = createSnapshot()
    vi.mocked(driveBrowserApi.unlockShare).mockResolvedValue(snapshot)

    await expect(loadDriveBrowser({
      context: 'share',
      shareId: 'share-1',
      itemId: 'item-1',
      initialPassword: 'link-password',
    })).resolves.toBe(snapshot)

    expect(driveBrowserApi.unlockShare).toHaveBeenCalledWith('share-1', 'link-password', 'item-1', {})
    expect(driveBrowserApi.getShareItem).not.toHaveBeenCalled()
    expect(driveBrowserApi.getShareRoot).not.toHaveBeenCalled()
  })

  it('passes child pagination options to owner browser requests', async () => {
    const snapshot = createSnapshot()
    vi.mocked(driveBrowserApi.getOwnerItem).mockResolvedValue(snapshot)

    await expect(loadDriveBrowser({
      context: 'owner',
      surface: 'console',
      itemId: 'folder-1',
    }, { childrenOffset: 100, childrenLimit: 50 })).resolves.toBe(snapshot)

    expect(driveBrowserApi.getOwnerItem).toHaveBeenCalledWith(
      'folder-1',
      'console',
      { childrenOffset: 100, childrenLimit: 50 }
    )
  })
})

function createSnapshot(): DriveBrowserSnapshotDto {
  return {
    context: 'share',
    surface: 'standalone',
    current: {
      id: 'item-1',
      name: 'file.txt',
      type: 'file',
      size: '1',
      mimeType: 'text/plain',
      updatedAt: '2026-06-13T00:00:00.000Z',
      browserUrl: '/share/share-1/items/item-1',
      downloadUrl: '/share/share-1/items/item-1/download',
      previewKind: 'text',
    },
    breadcrumbs: [],
    children: [],
    preview: null,
    canDownload: true,
    canZip: false,
  }
}
