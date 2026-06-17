import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { DriveFileVersionDto } from '@synapse/shared'
import { DriveFileVersionContent } from './drive-file-versions-dialog'

describe('DriveFileVersionContent', () => {
  it('keeps version rows inside an internal scroll area', () => {
    const html = renderVersions([
      version({ id: 'version-4', versionNumber: 4, isCurrent: true }),
      version({ id: 'version-3', versionNumber: 3 }),
      version({ id: 'version-2', versionNumber: 2 }),
      version({ id: 'version-1', versionNumber: 1 }),
    ])

    expect(html).toContain('data-slot="scroll-area"')
    expect(html).toContain('min-h-0 flex-1')
    expect(html).toContain('v4')
    expect(html).toContain('v1')
  })

  it('limits current version actions to download', () => {
    const html = renderVersions([
      version({ id: 'version-current', versionNumber: 4, isCurrent: true }),
    ])

    expect(html).toContain('当前')
    expect(html).toContain('下载')
    expect(html).not.toContain('恢复')
    expect(html).not.toContain('保留')
    expect(html).not.toContain('删除')
  })

  it('shows restore, pin, and delete actions for older versions', () => {
    const html = renderVersions([
      version({ id: 'version-old', versionNumber: 3 }),
    ])

    expect(html).toContain('下载')
    expect(html).toContain('恢复')
    expect(html).toContain('保留')
    expect(html).toContain('删除')
  })
})

function renderVersions(versions: readonly DriveFileVersionDto[]) {
  return renderToStaticMarkup(
    createElement(DriveFileVersionContent, {
      itemId: 'item-1',
      versions,
      loading: false,
      error: null,
      pinningVersionId: null,
      pinning: false,
      onPin: vi.fn(),
      onRestore: vi.fn(),
      onDelete: vi.fn(),
    })
  )
}

function version(overrides: Partial<DriveFileVersionDto> = {}): DriveFileVersionDto {
  return {
    id: 'version-1',
    itemId: 'item-1',
    versionNumber: 1,
    size: '7372',
    mimeType: 'text/markdown',
    source: 'upload',
    isCurrent: false,
    isPinned: false,
    deletePending: false,
    restoredFromVersionId: null,
    createdAt: '2026-06-17T12:01:33.000Z',
    createdBy: null,
    ...overrides,
  }
}
