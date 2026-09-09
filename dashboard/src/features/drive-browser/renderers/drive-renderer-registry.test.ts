import { describe, expect, it } from 'vitest'
import type { DriveBrowserSnapshotDto } from '@synapse/shared'
import { getDriveRendererOptions, selectDefaultDriveRenderer } from './drive-renderer-registry'

describe('Drive Milkdown renderer registration', () => {
  it('offers Milkdown for plain Markdown without changing the default renderer', () => {
    const options = getDriveRendererOptions(snapshot({ name: 'notes.md', mimeType: 'text/markdown' }))

    expect(options.map((option) => option.id)).toEqual(['markdown', 'mdxeditor', 'milkdown', 'code'])
    expect(options.map((option) => option.label)).toEqual(['预览', 'MDXeditor', 'Milkdown', '代码'])
    expect(selectDefaultDriveRenderer(snapshot({ name: 'notes.md' }))?.id).toBe('markdown')
  })

  it('accepts Markdown extensions and normalized MIME types but excludes .mdx names', () => {
    expect(rendererIds({ name: 'guide.markdown', mimeType: null })).toContain('milkdown')
    expect(rendererIds({ name: 'README', mimeType: 'text/markdown; charset=utf-8' })).toContain('milkdown')
    expect(rendererIds({ name: 'README', mimeType: 'text/x-markdown' })).toContain('milkdown')
    expect(rendererIds({ name: 'README', mimeType: ' TEXT/X-MARKDOWN ; charset=utf-8' })).toContain('milkdown')
    expect(rendererIds({ name: 'component.mdx', mimeType: 'text/markdown' })).not.toContain('milkdown')
    expect(rendererIds({ name: 'component.MDX', mimeType: 'text/x-markdown; charset=utf-8' })).not.toContain('milkdown')
  })

  it('disables Milkdown when the Markdown preview is truncated', () => {
    const milkdown = getDriveRendererOptions(snapshot({ truncated: true })).find((option) => option.id === 'milkdown')

    expect(milkdown?.disabledReason).toBe('超过富文本限制')
  })
})

function rendererIds(overrides: SnapshotOverrides): readonly string[] {
  return getDriveRendererOptions(snapshot(overrides)).map((option) => option.id)
}

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
