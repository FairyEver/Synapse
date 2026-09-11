import { describe, expect, it } from 'vitest'
import type { DriveBrowserSnapshotDto } from '@synapse/shared'
import { getDriveRendererOptions, selectDefaultDriveRenderer } from './drive-renderer-registry'

describe('Drive renderer registration', () => {
  it('offers one rich-text editor for Markdown without changing the default renderer', () => {
    const options = getDriveRendererOptions(snapshot({ name: 'notes.md', mimeType: 'text/markdown' }))

    expect(options.map((option) => option.id)).toEqual(['markdown', 'mdxeditor', 'code'])
    expect(options.map((option) => option.label)).toEqual(['预览', 'MDXeditor', '代码'])
    expect(selectDefaultDriveRenderer(snapshot({ name: 'notes.md' }))?.id).toBe('markdown')
  })

  it('disables the rich-text editor when the Markdown preview is truncated', () => {
    const editor = getDriveRendererOptions(snapshot({ truncated: true })).find((option) => option.id === 'mdxeditor')

    expect(editor?.disabledReason).toBe('超过富文本限制')
  })
})

type SnapshotOverrides = {
  readonly name?: string
  readonly mimeType?: string | null
  readonly truncated?: boolean
}

function snapshot(overrides: SnapshotOverrides = {}): DriveBrowserSnapshotDto {
  return {
    context: 'owner',
    surface: 'console',
    current: {
      id: 'file',
      name: overrides.name ?? 'notes.md',
      type: 'file',
      size: '12',
      mimeType: overrides.mimeType === undefined ? 'text/markdown' : overrides.mimeType,
      updatedAt: '2026-09-08T00:00:00.000Z',
      previewKind: 'markdown',
      browserUrl: '/console/drive/items/file',
      downloadUrl: '/api/drive/items/file/content',
    },
    breadcrumbs: [],
    preview: {
      kind: 'markdown',
      text: '# Notes',
      html: '<h1>Notes</h1>',
      outline: [],
      truncated: overrides.truncated ?? false,
      imageUrl: null,
      visitUrl: null,
      relativeImages: [],
    },
    edit: null,
    annotations: null,
    collaboration: null,
  }
}
