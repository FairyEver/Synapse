// @vitest-environment jsdom

import { act } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DriveBrowserSnapshotDto } from '@synapse/shared'
import { DriveRendererContent, DriveRendererShell } from './drive-renderer-shell'

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('@monaco-editor/react', async () => {
  const React = await vi.importActual<typeof import('react')>('react')

  return {
    default: ({
      value,
      options,
    }: {
      readonly value?: string
      readonly options?: { readonly readOnly?: boolean }
    }) => React.createElement('textarea', {
      'data-monaco-editor': 'true',
      readOnly: options?.readOnly,
      value: value ?? '',
    }),
  }
})

vi.mock('@mdxeditor/editor/style.css', () => ({}))

vi.mock('@mdxeditor/editor', async () => {
  const React = await vi.importActual<typeof import('react')>('react')

  return {
    MDXEditor: React.forwardRef(({
      markdown,
      readOnly,
    }: {
      readonly markdown: string
      readonly readOnly?: boolean
    }, ref: React.Ref<{ setMarkdown: (value: string) => void }>) => {
      React.useImperativeHandle(ref, () => ({
        setMarkdown: () => undefined,
      }), [])
      return React.createElement('textarea', {
        'data-mdxeditor': 'true',
        readOnly,
        value: markdown,
      })
    }),
    BlockTypeSelect: () => null,
    BoldItalicUnderlineToggles: () => null,
    CreateLink: () => null,
    InsertTable: () => null,
    InsertThematicBreak: () => null,
    ListsToggle: () => null,
    UndoRedo: () => null,
    codeBlockPlugin: () => ({ name: 'codeBlockPlugin' }),
    codeMirrorPlugin: () => ({ name: 'codeMirrorPlugin' }),
    headingsPlugin: () => ({ name: 'headingsPlugin' }),
    linkDialogPlugin: () => ({ name: 'linkDialogPlugin' }),
    linkPlugin: () => ({ name: 'linkPlugin' }),
    listsPlugin: () => ({ name: 'listsPlugin' }),
    markdownShortcutPlugin: () => ({ name: 'markdownShortcutPlugin' }),
    quotePlugin: () => ({ name: 'quotePlugin' }),
    tablePlugin: () => ({ name: 'tablePlugin' }),
    thematicBreakPlugin: () => ({ name: 'thematicBreakPlugin' }),
    toolbarPlugin: () => ({ name: 'toolbarPlugin' }),
  }
})

let root: Root | null = null
let host: HTMLDivElement | null = null

afterEach(() => {
  if (root) act(() => root?.unmount())
  host?.remove()
  root = null
  host = null
  document.body.innerHTML = ''
})

describe('DriveRendererShell', () => {
  it('renders registered code actions in the shared header', () => {
    window.history.pushState(null, '', '/share/share-1')
    renderShell({
      snapshot: baseSnapshot({
        context: 'share',
        edit: { canEdit: false, reason: 'login_required', currentVersionId: null },
      }),
    })

    expect(document.querySelector('[data-drive-preview-header="true"]')).not.toBeNull()
    expect(anchorWithText('登录后编辑').getAttribute('href')).toBe('/console/sign-in?redirect=%2Fshare%2Fshare-1')
  })

  it('allows direct content rendering without a toolbar provider', () => {
    const html = renderToStaticMarkup(
      <DriveRendererContent
        snapshot={baseSnapshot()}
        selected={{ id: 'code', label: '代码', container: 'full' }}
        body
      />,
    )

    expect(html).toContain('data-drive-code-renderer="true"')
  })
})

function renderShell({ snapshot }: { readonly snapshot: DriveBrowserSnapshotDto }) {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  act(() => {
    root?.render(<DriveRendererShell snapshot={snapshot} rendererId='code' />)
  })
}

function baseSnapshot(input: Partial<DriveBrowserSnapshotDto> = {}): DriveBrowserSnapshotDto {
  return {
    context: 'owner',
    surface: 'standalone',
    current: {
      id: 'file',
      name: 'script.ts',
      type: 'file',
      size: '18',
      mimeType: 'text/typescript',
      updatedAt: '2026-06-09T00:00:00.000Z',
      previewKind: 'code',
      browserUrl: '/drive/items/file',
      downloadUrl: '/drive/items/file/download',
    },
    breadcrumbs: [{ id: 'root', name: 'root', browserUrl: '/drive/items/root' }],
    children: [],
    preview: {
      kind: 'code',
      text: 'const initial = true',
      html: null,
      outline: null,
      truncated: false,
      imageUrl: null,
      visitUrl: null,
    },
    edit: {
      canEdit: true,
      editorKind: 'text',
      currentVersionId: 'version-1',
      maxInlineEditBytes: '1048576',
      reason: null,
    },
    canDownload: true,
    canZip: false,
    ...input,
  }
}

function anchorWithText(text: string): HTMLAnchorElement {
  const element = Array.from(document.querySelectorAll('a')).find((anchor) => anchor.textContent?.includes(text))
  if (!(element instanceof HTMLAnchorElement)) throw new Error(`anchor not found: ${text}`)
  return element
}
