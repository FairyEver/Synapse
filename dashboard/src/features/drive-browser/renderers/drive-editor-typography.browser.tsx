import '@/styles/index.css'
import '@mdxeditor/editor/style.css'
import type { ComponentProps } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { DriveBrowserEditDto, DriveBrowserItemDto, DriveBrowserPreviewDto } from '@synapse/shared'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { DriveMDXeditorRenderer } from './mdxeditor-renderer'
import { DriveRendererToolbarProvider } from './drive-renderer-toolbar-context'

let host: HTMLElement | null = null
let lateVendorStyle: HTMLStyleElement | null = null

afterEach(() => {
  host?.remove()
  lateVendorStyle?.remove()
  host = null
  lateVendorStyle = null
})

describe('drive editor typography in Chromium', () => {
  it('applies the Drive document typography to the rich-text editor', async () => {
    const screen = await render(
      <QueryClientProvider client={new QueryClient()}>
        <DriveRendererToolbarProvider>
          <DriveMDXeditorRenderer
            current={current()}
            preview={preview()}
            edit={editable()}
            editContext={editContext()}
          />
        </DriveRendererToolbarProvider>
      </QueryClientProvider>,
    )

    try {
      await expect.poll(() => document.querySelector<HTMLElement>('.drive-mdxeditor-content h1')).not.toBeNull()
      const root = document.querySelector<HTMLElement>('.drive-mdxeditor-content')!

      expect(getComputedStyle(root.querySelector('h1')!).fontSize).toBe('32px')
      expect(getComputedStyle(root.querySelector('h6')!).fontSize).toBe('16px')
      expect(getComputedStyle(root.querySelector('p')!).lineHeight).toBe('24px')
      expect(getComputedStyle(root.querySelector('code')!).color).toBe(getComputedStyle(root).color)
    } finally {
      await screen.unmount()
    }
  })

  it('wins over editor styles injected after the project stylesheet', () => {
    const root = renderSyntheticEditorFixture()
    const before = snapshotStyles(root)
    lateVendorStyle = document.createElement('style')
    lateVendorStyle.textContent = `
      .drive-mdxeditor-content h1 { color: var(--destructive); font-size: 2.625rem; font-weight: 400; }
      .drive-mdxeditor-content code { color: var(--destructive); font-size: 2rem; }
    `
    document.head.append(lateVendorStyle)

    expect(snapshotStyles(root)).toEqual(before)
  })

  it('does not apply document-cell styling to table controls', () => {
    const root = renderSyntheticEditorFixture()
    const contentCell = root.querySelector<HTMLElement>('td:not([data-tool-cell])')!
    const toolCell = root.querySelector<HTMLElement>('td[data-tool-cell]')!

    expect(getComputedStyle(contentCell).paddingInlineStart).toBe('12px')
    expect(getComputedStyle(toolCell).paddingInlineStart).not.toBe('12px')
  })
})

function renderSyntheticEditorFixture(): HTMLElement {
  host = document.createElement('main')
  host.innerHTML = `<section class="drive-mdxeditor-content">
    <h1>Heading 1</h1>
    <p>Paragraph with <code>inline code</code>.</p>
    <table><tbody><tr><th>Heading</th><td>Value</td><td data-tool-cell="true">Tools</td></tr></tbody></table>
  </section>`
  document.body.append(host)
  return host.querySelector('.drive-mdxeditor-content')!
}

function snapshotStyles(root: HTMLElement): readonly string[] {
  return ['h1', 'code'].flatMap((selector) => {
    const styles = getComputedStyle(root.querySelector(selector)!)
    return [styles.color, styles.fontSize, styles.fontWeight]
  })
}

const MARKDOWN = [
  '# Heading 1',
  '## Heading 2',
  '### Heading 3',
  '#### Heading 4',
  '##### Heading 5',
  '###### Heading 6',
  '',
  'Paragraph with `inline code`.',
].join('\n')

function current(): DriveBrowserItemDto {
  return {
    id: 'file',
    name: 'notes.md',
    type: 'file',
    size: '12',
    mimeType: 'text/markdown',
    updatedAt: '2026-09-08T00:00:00.000Z',
    previewKind: 'markdown',
    browserUrl: '/console/drive/items/file',
    downloadUrl: '/api/drive/items/file/content',
  }
}

function preview(): DriveBrowserPreviewDto {
  return {
    kind: 'markdown',
    text: MARKDOWN,
    html: '<h1>Heading 1</h1>',
    outline: [],
    truncated: false,
    imageUrl: null,
    visitUrl: null,
    relativeImages: [],
  }
}

function editable(): DriveBrowserEditDto {
  return { canEdit: true, editorKind: 'text', currentVersionId: 'version-1', reason: null }
}

function editContext(): NonNullable<ComponentProps<typeof DriveMDXeditorRenderer>['editContext']> {
  return {
    reload: vi.fn(async () => ({} as never)),
    reloading: false,
    saveText: vi.fn(async () => ({} as never)),
    savingText: false,
  }
}
