import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DriveBrowserSnapshotDto } from '@synapse/shared'
import { driveBrowserApi } from '@/lib/api'

import { loadDriveBrowser, toDriveBrowserQueryKey } from './use-drive-browser'

vi.mock('@/lib/api', () => ({
  driveBrowserApi: {
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

    expect(driveBrowserApi.unlockShare).toHaveBeenCalledWith('share-1', 'link-password', 'item-1')
    expect(driveBrowserApi.getShareItem).not.toHaveBeenCalled()
    expect(driveBrowserApi.getShareRoot).not.toHaveBeenCalled()
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
      url: '/files/share-1/items/item-1',
      downloadUrl: '/files/share-1/items/item-1/download',
      renderUrl: null,
      zipUrl: null,
      previewKind: 'text',
    },
    breadcrumbs: [],
    children: [],
    preview: null,
  }
}
