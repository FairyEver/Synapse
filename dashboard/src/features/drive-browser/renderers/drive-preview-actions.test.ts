import { describe, expect, it } from 'vitest'
import type { DriveBrowserSnapshotDto } from '@synapse/shared'
import { getDrivePreviewDisplayName, getDrivePreviewDriveBrowserUrl, getDrivePreviewSystemActions } from './drive-preview-actions'

const snapshot: DriveBrowserSnapshotDto = {
  context: 'owner', surface: 'standalone',
  current: {
    id: 'file', name: 'notes.md', type: 'file', size: '12', mimeType: 'text/markdown',
    updatedAt: '2026-10-31T00:00:00Z', previewKind: 'markdown',
    browserUrl: '/drive/items/file', downloadUrl: '/drive/items/file/download',
  },
  breadcrumbs: [], children: [], preview: null, edit: null, annotation: null,
  canDownload: true, canZip: false,
}

describe('standalone reader actions', () => {
  it('uses the document heading for reading and keeps file identity for source views and untitled documents', () => {
    const titled = { ...snapshot, preview: { outline: [{ id: 'title', text: '文档标题', depth: 1, children: [] }] } } as DriveBrowserSnapshotDto
    expect(getDrivePreviewDisplayName(titled, 'markdown')).toBe('文档标题')
    expect(getDrivePreviewDisplayName(titled, 'mdxeditor')).toBe('文档标题')
    expect(getDrivePreviewDisplayName(titled, 'code')).toBe('notes.md')
    expect(getDrivePreviewDisplayName(snapshot, 'markdown')).toBe('notes.md')
  })
  it('retains download and version actions without linking to the removed console cloud drive', () => {
    const actions = getDrivePreviewSystemActions(snapshot)
    expect(actions.map((action) => action.id)).toContain('download')
    expect(actions.map((action) => action.id)).toContain('versions')
    expect(actions.map((action) => action.id)).not.toContain('open-in-drive')
    expect(getDrivePreviewDriveBrowserUrl(snapshot)).toBeNull()
  })
})
